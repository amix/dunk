import fs from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./config";
import { DUNK_COMMENTS_RELATIVE_PATH } from "./dunkPaths";
import { buildGitDiffRawArgs, listGitUntrackedFiles, resolveGitRepoRoot, runGitText } from "./git";
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
 * Polling should scale with filesystem activity, not patch size. Use cheap
 * commands that only report whether something changed: `git diff --raw` for
 * tracked work and `git rev-parse` for ref-backed reviews.
 *
 * `--raw` rather than `--numstat`: numstat reports only counts, so two
 * same-shape edits (foo -> bar then bar -> baz, each "1\t1\tpath") would share a
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

/** Compute a change-detection signature for one watchable input. */
export function computeWatchSignature(input: CliInput) {
  const parts: string[] = [input.kind];

  switch (input.kind) {
    case "vcs":
    case "show":
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
