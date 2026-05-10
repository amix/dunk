/**
 * `.tunk/comments.json` reader/writer and drift detection.
 *
 * One JSON file holds all comments for the repo. Each comment carries a
 * `file`, a 1-based `line`, a 16-hex SHA-256 `anchor` of the line's local
 * context (the line itself plus one above and one below, all right-trimmed),
 * and a free-text `body`. On load we recompute the anchor at the recorded
 * line; if it matches we render the comment in place, otherwise it is
 * "drifted" and the UI pins it to the top of the diff.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot } from "./config";
import type { AgentAnnotation, Changeset, DiffFile } from "./types";

const SCHEMA_VERSION = 1;
const COMMENTS_DIR = ".tunk";
const COMMENTS_FILE = "comments.json";
const ANCHOR_HEX_LEN = 16;

/** A persisted comment as it appears on disk. */
export interface PersistedComment {
  id: number;
  file: string;
  line: number;
  anchor: string;
  body: string;
}

/** Top-level shape of `.tunk/comments.json`. */
export interface CommentsFile {
  schema: number;
  comments: PersistedComment[];
}

/** Comment that anchored cleanly against the current diff. */
export interface AnchoredComment extends PersistedComment {
  state: "anchored";
}

/** Comment whose recorded anchor no longer matches the file. */
export interface DriftedComment extends PersistedComment {
  state: "drifted";
  reason: "missing-file" | "out-of-range" | "anchor-mismatch";
}

export type ResolvedComment = AnchoredComment | DriftedComment;

/** Map a freshly loaded file's content to its 1-based lines, no trailing \n. */
function splitLines(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/\s+$/, ""));
}

/** Compute the deterministic anchor for one (file content, line) pair. */
export function computeAnchor(lines: string[], line: number): string {
  if (line < 1 || line > lines.length) {
    return "";
  }

  const above = line > 1 ? lines[line - 2] : "";
  const target = lines[line - 1];
  const below = line < lines.length ? lines[line] : "";
  const hash = createHash("sha256");
  hash.update([above, target, below].join("\n"));
  return hash.digest("hex").slice(0, ANCHOR_HEX_LEN);
}

/** Read `.tunk/comments.json` from the repo root, returning [] if missing. */
export function readCommentsFile(repoRoot: string): CommentsFile {
  const path = join(repoRoot, COMMENTS_DIR, COMMENTS_FILE);
  if (!existsSync(path)) {
    return { schema: SCHEMA_VERSION, comments: [] };
  }

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<CommentsFile>;
  if (parsed.schema !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported tunk comments schema ${parsed.schema} at ${path} (expected ${SCHEMA_VERSION}).`,
    );
  }

  return {
    schema: SCHEMA_VERSION,
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
  };
}

/** Atomically write the comments file using a temp + rename. */
export function writeCommentsFile(repoRoot: string, file: CommentsFile): void {
  const dir = join(repoRoot, COMMENTS_DIR);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, COMMENTS_FILE);
  const tempPath = join(dir, `.${COMMENTS_FILE}.tmp`);
  const sorted: CommentsFile = {
    schema: SCHEMA_VERSION,
    comments: [...file.comments].sort((a, b) => a.id - b.id),
  };
  writeFileSync(tempPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  // Same-filesystem rename is atomic, so concurrent readers never see a partial file.
  renameSync(tempPath, finalPath);
}

/** Compute the next available integer id for a new comment. */
export function nextCommentId(file: CommentsFile): number {
  return file.comments.reduce((max, comment) => Math.max(max, comment.id), 0) + 1;
}

/** Append one comment and return the updated file shape (does not write). */
export function withAddedComment(
  file: CommentsFile,
  draft: Omit<PersistedComment, "id">,
): { file: CommentsFile; comment: PersistedComment } {
  const comment: PersistedComment = { id: nextCommentId(file), ...draft };
  return {
    file: { ...file, comments: [...file.comments, comment] },
    comment,
  };
}

/** Remove one comment by id; throws when the id is missing. */
export function withRemovedComment(file: CommentsFile, id: number): CommentsFile {
  const next = file.comments.filter((comment) => comment.id !== id);
  if (next.length === file.comments.length) {
    throw new Error(`No tunk comment with id ${id}.`);
  }

  return { ...file, comments: next };
}

/** Remove every comment whose id matches one of the supplied set. */
export function withRemovedComments(file: CommentsFile, ids: Iterable<number>): CommentsFile {
  const idSet = new Set(ids);
  return {
    ...file,
    comments: file.comments.filter((comment) => !idSet.has(comment.id)),
  };
}

/** Resolve persisted comments against current file contents. */
export function resolveComments(
  comments: PersistedComment[],
  fileContentByPath: Map<string, string | undefined>,
): ResolvedComment[] {
  return comments.map((comment) => {
    const content = fileContentByPath.get(comment.file);
    if (content === undefined) {
      return { ...comment, state: "drifted", reason: "missing-file" } as DriftedComment;
    }

    const lines = splitLines(content);
    if (comment.line < 1 || comment.line > lines.length) {
      return { ...comment, state: "drifted", reason: "out-of-range" } as DriftedComment;
    }

    const anchor = computeAnchor(lines, comment.line);
    if (anchor !== comment.anchor) {
      return { ...comment, state: "drifted", reason: "anchor-mismatch" } as DriftedComment;
    }

    return { ...comment, state: "anchored" } as AnchoredComment;
  });
}

/** Map an anchored comment to the agent-annotation shape used by the renderer. */
export function commentToAnnotation(comment: AnchoredComment): AgentAnnotation {
  return {
    id: `tunk-comment:${comment.id}`,
    summary: comment.body,
    newRange: [comment.line, comment.line],
    source: "tunk",
  };
}

/**
 * Merge anchored comments into a Changeset's per-file `agent.annotations` so the
 * existing renderer surface picks them up. Drifted comments are returned
 * separately for top-of-diff rendering.
 */
export function applyCommentsToChangeset(
  changeset: Changeset,
  resolved: ResolvedComment[],
  fileContentByPath: Map<string, string | undefined>,
): { changeset: Changeset; drifted: DriftedComment[] } {
  const anchoredByPath = new Map<string, AnchoredComment[]>();
  const drifted: DriftedComment[] = [];

  for (const comment of resolved) {
    if (comment.state === "anchored") {
      const list = anchoredByPath.get(comment.file) ?? [];
      list.push(comment);
      anchoredByPath.set(comment.file, list);
      continue;
    }

    drifted.push(comment);
  }

  const files = changeset.files.map((file) => mergeFileAnnotations(file, anchoredByPath));
  void fileContentByPath;
  return {
    changeset: { ...changeset, files },
    drifted,
  };
}

/** Layer anchored user comments onto a single DiffFile's agent annotations. */
function mergeFileAnnotations(
  file: DiffFile,
  anchoredByPath: Map<string, AnchoredComment[]>,
): DiffFile {
  const anchored = anchoredByPath.get(file.path) ?? anchoredByPath.get(file.previousPath ?? "");
  if (!anchored || anchored.length === 0) {
    return file;
  }

  const annotations = anchored.map(commentToAnnotation);
  return {
    ...file,
    agent: {
      path: file.path,
      summary: file.agent?.summary,
      annotations: [...(file.agent?.annotations ?? []), ...annotations],
    },
  };
}

/** Resolve the repo's comments file path, even when the file does not exist yet. */
export function commentsFilePath(cwd = process.cwd()): string | undefined {
  const repoRoot = findRepoRoot(cwd);
  return repoRoot ? join(repoRoot, COMMENTS_DIR, COMMENTS_FILE) : undefined;
}

/** Return the directory holding the comments file, creating parents as needed. */
export function ensureCommentsDir(repoRoot: string): string {
  const dir = join(repoRoot, COMMENTS_DIR);
  mkdirSync(dir, { recursive: true });
  return dirname(join(dir, COMMENTS_FILE));
}

/** Find every comment whose `file` and post-image `line` fall inside one hunk. */
export function commentsForHunkRange(
  comments: PersistedComment[],
  filePath: string,
  postLineRange: [number, number],
): PersistedComment[] {
  const [start, end] = postLineRange;
  return comments.filter(
    (comment) => comment.file === filePath && comment.line >= start && comment.line <= end,
  );
}

/** Read, mutate, write the comments file in one go. Returns the loaded shape. */
export function mutateCommentsFile(
  repoRoot: string,
  mutate: (current: CommentsFile) => CommentsFile,
): CommentsFile {
  const current = readCommentsFile(repoRoot);
  const next = mutate(current);
  writeCommentsFile(repoRoot, next);
  return next;
}
