import fs from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./config";
import { DUNK_COMMENTS_RELATIVE_PATH } from "./dunkPaths";
import {
  buildGitDiffRawArgs,
  listGitUntrackedFiles,
  resolveGitRepoRoot,
  resolveWorktreeBaseRef,
  runGitText,
  WORKTREE_BASE_REF,
} from "./git";
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
 * List the paths whose working-tree side `git diff --raw -z` could not hash.
 *
 * Raw output reports a working-tree post-image as an all-zero blob id ("work
 * tree out of sync with the index"), so a second edit to an already-dirty file
 * leaves the raw line unchanged. Those paths need a stat signature instead.
 * Rename and copy records carry a source and a destination path; the
 * destination is the file on disk.
 */
function parseUnhashedWorkingTreePaths(raw: string): string[] {
  const fields = raw.split("\0");
  const paths: string[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const header = fields[index];
    if (!header?.startsWith(":")) {
      continue;
    }

    const [, , , dstBlob = "", status = ""] = header.slice(1).split(" ");
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    const path = fields[index + pathCount];
    index += pathCount;

    if (path && /^0+$/.test(dstBlob)) {
      paths.push(path);
    }
  }

  return paths;
}

/**
 * Build a cheap change-detection signature for VCS inputs.
 *
 * Polling should scale with filesystem activity, not patch size. `git diff
 * --raw` covers tracked work: index-side post-images come with real blob ids,
 * and working-tree post-images (which raw prints as all zeros) get a stat
 * signature so repeated edits to an already-dirty file still register.
 * Untracked files are stat-signed the same way.
 *
 * The full patch still runs once during the reload, which is when we
 * actually need the bytes.
 */
function gitWorkingTreeWatchSignature(input: Extract<CliInput, { kind: "vcs" }>) {
  // Branch reviews diff against a merge-base the loader resolves per load, and
  // re-resolving it every poll costs up to ~9 git spawns. HEAD plus the tree vs
  // HEAD pins the same diff for a fixed base, so commits, resets, rebases, and
  // checkouts all register. A base ref that moves (`git fetch`) still needs `r`.
  const comparedInput = input.branchReview
    ? { ...input, branchReview: undefined, range: WORKTREE_BASE_REF }
    : input;
  // Resolve the same base the loader uses (incl. the unborn-HEAD empty-tree
  // fallback) so the signature probe doesn't crash on `git diff --raw HEAD` in
  // a repo with no commits. Untracked detection keeps the original input.
  const baseInput = { ...comparedInput, range: resolveWorktreeBaseRef(comparedInput) };
  const head = input.branchReview ? runGitText({ input, args: ["rev-parse", "HEAD"] }) : "";
  const raw = runGitText({ input, args: buildGitDiffRawArgs(baseInput) });
  const repoRoot = resolveGitRepoRoot(input);
  const trackedSignatures = parseUnhashedWorkingTreePaths(raw).map(
    (filePath) => `tracked:${statSignature(join(repoRoot, filePath))}`,
  );
  const untrackedSignatures = listGitUntrackedFiles(input, { repoRoot }).map(
    (filePath) => `untracked:${statSignature(join(repoRoot, filePath))}`,
  );

  return [head, raw, ...trackedSignatures, ...untrackedSignatures].join("\n---\n");
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
