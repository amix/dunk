import fs from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./config";
import { DUNK_COMMENTS_RELATIVE_PATH } from "./dunkPaths";
import {
  buildGitDiffRawArgs,
  listGitUntrackedFiles,
  resolveGitRepoRoot,
  runGitText,
} from "./git";
import { runJjText } from "./jj";
import type { CliInput } from "./types";

/** Return whether the current input can be rebuilt from files or VCS state without rereading stdin. */
export function canReloadInput(input: CliInput) {
  return input.kind !== "patch" || Boolean(input.file && input.file !== "-");
}

/** Format one file stat into a stable signature fragment, or mark the path missing.
 *
 * Includes mode + ctime in addition to size/mtime/ino so chmod-only changes and
 * same-size in-place rewrites that don't bump mtime still register as a change.
 * Uses lstat so symlink target changes show up via the link's own stat fields.
 */
function statSignature(path: string) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(path);
  } catch {
    return `${path}:missing`;
  }
  return `${path}:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
}

/**
 * Build a cheap change-detection signature for VCS inputs.
 *
 * The previous version called the full `git diff` (or `jj diff`) every poll
 * tick, allocating a complete patch string four times per second. That's
 * expensive on medium-to-large repos and scales with patch size instead of
 * with actual filesystem activity. We swap in cheap commands that only
 * report *that* something changed: `git diff --raw` (content-addressed via
 * per-file blob hashes) for tracked work, `git rev-parse` for ref-backed
 * reviews, `jj log -T commit_id` for jj.
 *
 * `--raw` rather than `--numstat`: numstat reports only counts, so two
 * same-shape edits (foo→bar then bar→baz, each "1\t1\tpath") would share a
 * signature and watch mode would silently keep stale output. `--raw` includes
 * post-image blob hashes that change on any content edit.
 *
 * The full patch still runs once during the reload, which is when we
 * actually need the bytes.
 */
function gitWorkingTreeWatchSignature(input: Extract<CliInput, { kind: "vcs" }>) {
  const raw = runGitText({ input, args: buildGitDiffRawArgs(input) });
  const repoRoot = resolveGitRepoRoot(input);
  const untrackedSignatures = listGitUntrackedFiles(input, { repoRoot }).map(
    (filePath) => `untracked:${statSignature(join(repoRoot, filePath))}`,
  );

  return [raw, ...untrackedSignatures].join("\n---\n");
}

function gitVcsSignature(input: Extract<CliInput, { kind: "vcs" | "show" | "stash-show" }>) {
  switch (input.kind) {
    case "vcs":
      return gitWorkingTreeWatchSignature(input);
    case "show":
      // Resolve the ref to its commit SHA. Cheap, and changes only when the
      // ref moves (e.g., HEAD after a new commit).
      return runGitText({ input, args: ["rev-parse", input.ref ?? "HEAD"] });
    case "stash-show":
      return runGitText({ input, args: ["rev-parse", input.ref ?? "stash@{0}"] });
  }
}

function jjVcsSignature(input: Extract<CliInput, { kind: "vcs" | "show" }>) {
  // jj log with a fixed template emits just the commit id, which is enough
  // to detect any change in the working copy or the reviewed revset.
  switch (input.kind) {
    case "vcs":
      return runJjText({
        input,
        args: ["log", "--no-graph", "-T", "commit_id", "-r", input.range ?? "@"],
      });
    case "show":
      return runJjText({
        input,
        args: ["log", "--no-graph", "-T", "commit_id", "-r", input.ref ?? "@"],
      });
  }
}

/** Compute a change-detection signature for one watchable input. */
export function computeWatchSignature(input: CliInput) {
  const parts: string[] = [input.kind];

  switch (input.kind) {
    case "vcs":
      parts.push(input.options.vcs === "jj" ? jjVcsSignature(input) : gitVcsSignature(input));
      break;
    case "show":
      parts.push(input.options.vcs === "jj" ? jjVcsSignature(input) : gitVcsSignature(input));
      break;
    case "stash-show":
      parts.push(gitVcsSignature(input));
      break;
    case "diff":
    case "difftool":
      parts.push(statSignature(input.left), statSignature(input.right));
      break;
    case "patch":
      if (!input.file || input.file === "-") {
        throw new Error("Watch mode requires a patch file path instead of stdin.");
      }
      parts.push(statSignature(input.file));
      break;
  }

  // Tracking the comments file too lets watch mode pick up external edits to
  // `.dunk/comments.json` without an extra fs.watch hookup.
  const repoRoot = findRepoRoot();
  if (repoRoot) {
    parts.push(`comments:${statSignature(join(repoRoot, DUNK_COMMENTS_RELATIVE_PATH))}`);
  }

  return parts.join("\n---\n");
}
