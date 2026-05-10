/** `.dunk/comments.json` reader/writer and drift detection. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { DUNK_COMMENTS_FILENAME, DUNK_DIR } from "./dunkPaths";
import type { Annotation, Changeset, DiffFile, DriftReason } from "./types";

const SCHEMA_VERSION = 1;
const ANCHOR_HEX_LEN = 16;

/**
 * A persisted comment as it appears on disk.
 *
 * `range` is the inclusive 1-based [start, end] post-image line range of the
 * hunk the comment is attached to. `dunk` only lets you comment at the hunk
 * level, so the range communicates "this comment is about these lines", not
 * just one line. Agents addressing comments should consider the full range
 * when deciding what to fix.
 *
 * `line` is the row used for drift detection (the anchor hash is computed
 * from its surrounding context). It's typically the hunk's last post-image
 * line, but the value is opaque to agents.
 */
export interface PersistedComment {
  id: number;
  file: string;
  line: number;
  range: [number, number];
  anchor: string;
  body: string;
}

/** Top-level shape of `.dunk/comments.json`. */
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
  reason: DriftReason;
}

export type ResolvedComment = AnchoredComment | DriftedComment;

/** Map a freshly loaded file's content to its 1-based lines, no trailing \n. */
export function splitLines(text: string): string[] {
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

/**
 * Read the post-image of `relPath` (relative to `repoRoot`) and compute the
 * anchor for one line. Returns null when the file can't be read or the line
 * is out of range — both situations callers treat as "skip this comment".
 */
export function computeAnchorForFile(
  repoRoot: string,
  relPath: string,
  line: number,
): string | null {
  let content: string;
  try {
    content = readFileSync(resolvePath(repoRoot, relPath), "utf8");
  } catch {
    return null;
  }

  const anchor = computeAnchor(splitLines(content), line);
  return anchor || null;
}

/** Read `.dunk/comments.json` from the repo root, returning [] if missing. */
export function readCommentsFile(repoRoot: string): CommentsFile {
  const path = join(repoRoot, DUNK_DIR, DUNK_COMMENTS_FILENAME);
  if (!existsSync(path)) {
    return { schema: SCHEMA_VERSION, comments: [] };
  }

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<CommentsFile>;
  if (parsed.schema !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported dunk comments schema ${parsed.schema} at ${path} (expected ${SCHEMA_VERSION}).`,
    );
  }

  return {
    schema: SCHEMA_VERSION,
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
  };
}

/** Atomically write the comments file using a temp + rename. */
export function writeCommentsFile(repoRoot: string, file: CommentsFile): void {
  const dir = join(repoRoot, DUNK_DIR);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, DUNK_COMMENTS_FILENAME);
  const tempPath = join(dir, `.${DUNK_COMMENTS_FILENAME}.tmp`);
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
    throw new Error(`No dunk comment with id ${id}.`);
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

/** Remove every comment whose `file` matches one of the supplied repo-relative paths. */
export function withRemovedCommentsForFiles(
  file: CommentsFile,
  paths: Iterable<string>,
): CommentsFile {
  const pathSet = new Set(paths);
  const next = file.comments.filter((comment) => !pathSet.has(comment.file));
  if (next.length === file.comments.length) {
    return file;
  }

  return { ...file, comments: next };
}

/** Resolve persisted comments against current file contents. */
export function resolveComments(
  comments: PersistedComment[],
  fileContentByPath: Map<string, string | undefined>,
): ResolvedComment[] {
  // Split each file's content exactly once; comments often share a file.
  const linesByPath = new Map<string, string[]>();
  for (const [path, content] of fileContentByPath) {
    if (content !== undefined) {
      linesByPath.set(path, splitLines(content));
    }
  }

  return comments.map((comment) => {
    const lines = linesByPath.get(comment.file);
    if (!lines) {
      return { ...comment, state: "drifted", reason: "missing-file" } as DriftedComment;
    }

    if (comment.line < 1 || comment.line > lines.length) {
      return { ...comment, state: "drifted", reason: "out-of-range" } as DriftedComment;
    }

    if (computeAnchor(lines, comment.line) !== comment.anchor) {
      return { ...comment, state: "drifted", reason: "anchor-mismatch" } as DriftedComment;
    }

    return { ...comment, state: "anchored" } as AnchoredComment;
  });
}

/** Map an anchored comment to the inline annotation shape used by the renderer. */
export function commentToAnnotation(comment: AnchoredComment): Annotation {
  return {
    id: `dunk-comment:${comment.id}`,
    summary: comment.body,
    newRange: [comment.line, comment.line],
  };
}

/**
 * Merge anchored comments into each DiffFile's inline annotations so the
 * renderer picks them up. Drifted comments are returned separately for
 * top-of-diff rendering.
 */
export function applyCommentsToChangeset(
  changeset: Changeset,
  resolved: ResolvedComment[],
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
  return {
    changeset: { ...changeset, files },
    drifted,
  };
}

/** Layer anchored user comments onto a single DiffFile's inline annotations. */
function mergeFileAnnotations(
  file: DiffFile,
  anchoredByPath: Map<string, AnchoredComment[]>,
): DiffFile {
  const anchored = anchoredByPath.get(file.path) ?? anchoredByPath.get(file.previousPath ?? "");
  if (!anchored || anchored.length === 0) {
    return file;
  }

  return {
    ...file,
    annotations: [...file.annotations, ...anchored.map(commentToAnnotation)],
  };
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
  // Skip the write when the mutation was a no-op so we don't materialize an
  // empty .dunk/comments.json on disk just because the user pressed a delete
  // key on a hunk that has no comments.
  if (next === current) {
    return current;
  }

  writeCommentsFile(repoRoot, next);
  return next;
}
