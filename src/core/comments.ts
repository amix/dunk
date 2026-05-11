/** `.dunk/comments.json` reader/writer and drift detection. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { DUNK_COMMENTS_FILENAME, DUNK_DIR } from "./dunkPaths";
import { DunkUserError } from "./errors";
import { hunkLineRange } from "./hunkRange";
import { LARGE_FILE_MAX_BYTES } from "./limits";
import type { Annotation, Changeset, DiffFile, DriftReason, LineRange } from "./types";

/**
 * Resolve a comment's `file` to an absolute path inside `repoRoot`, or null
 * if the path is absolute or escapes the repo via `..` segments. `.dunk/`
 * comments are user/agent-editable, so a crafted entry could otherwise make
 * `dunk comments show` print arbitrary local files.
 */
export function resolveCommentPathWithinRepo(repoRoot: string, relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0 || isAbsolute(relPath)) {
    return null;
  }

  const absolutePath = resolvePath(repoRoot, relPath);
  const within = relative(repoRoot, absolutePath);
  if (within === "" || within.startsWith("..")) {
    return null;
  }

  return absolutePath;
}

const SCHEMA_VERSION = 1;
const ANCHOR_HEX_LEN = 16;

/**
 * Zod schema for a persisted comment. Keeps `.dunk/comments.json` honest
 * even when an agent (or hand-edit) drops in a malformed entry — without
 * this guard, missing `range`/`line`/`body` fields crash render with
 * cryptic `lines[0]` undefined errors.
 */
const PersistedCommentSchema = z
  .object({
    id: z.number().int().positive(),
    file: z.string().min(1),
    line: z.number().int().positive(),
    range: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .refine(([start, end]) => start <= end, {
        message: "range start must not exceed range end",
      }),
    anchor: z.string().regex(/^[0-9a-f]{16}$/, "anchor must be a 16-hex SHA-256 prefix"),
    body: z.string(),
  })
  // Strict so a typo'd field (e.g. `rationale`) trips validation instead of
  // silently sticking around through write cycles.
  .strict();

const CommentsFileSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION),
    comments: z.array(PersistedCommentSchema),
  })
  .strict();

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
  range: LineRange;
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
 * Stat-gate one file read: returns the contents only when the file fits
 * under `LARGE_FILE_MAX_BYTES`. Anything larger (or missing, or unreadable)
 * returns `undefined` so callers report it as drift instead of trying to
 * slurp the file into memory.
 */
function readPostImageIfSmallEnough(absolutePath: string): string | undefined {
  let size: number;
  try {
    size = statSync(absolutePath).size;
  } catch {
    return undefined;
  }
  if (size > LARGE_FILE_MAX_BYTES) {
    return undefined;
  }
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Read post-image content for every distinct file referenced by `comments`.
 * Returns a `Map<relativePath, content | undefined>`; entries that fail the
 * repo-relative check, exceed the size cap, or are unreadable get
 * `undefined`, which downstream `resolveComments` surfaces as
 * missing-file drift. Shared by the TUI loader and the CLI so neither
 * can read outside the repo or blow memory on a giant file.
 */
export function readPostImagesForComments(
  repoRoot: string,
  comments: readonly PersistedComment[],
): Map<string, string | undefined> {
  const contentByPath = new Map<string, string | undefined>();
  for (const comment of comments) {
    if (contentByPath.has(comment.file)) {
      continue;
    }

    const safePath = resolveCommentPathWithinRepo(repoRoot, comment.file);
    if (!safePath) {
      contentByPath.set(comment.file, undefined);
      continue;
    }

    contentByPath.set(comment.file, readPostImageIfSmallEnough(safePath));
  }
  return contentByPath;
}

/**
 * Read the post-image of `relPath` (relative to `repoRoot`) and compute the
 * anchor for one line. Returns null when the file can't be read, escapes the
 * repo, exceeds the size cap, or the line is out of range — callers all
 * treat this as "skip this anchor recomputation".
 */
export function computeAnchorForFile(
  repoRoot: string,
  relPath: string,
  line: number,
): string | null {
  const resolvedPath = resolveCommentPathWithinRepo(repoRoot, relPath);
  if (!resolvedPath) {
    return null;
  }

  const content = readPostImageIfSmallEnough(resolvedPath);
  if (content === undefined) {
    return null;
  }

  const anchor = computeAnchor(splitLines(content), line);
  return anchor || null;
}

/**
 * Format the first few zod issues into a multi-line, agent-actionable hint
 * (path, then the human-readable message), capped so a wildly broken file
 * doesn't drown the user in noise.
 */
function summarizeCommentsValidationIssues(error: z.ZodError): string[] {
  const limit = 5;
  const issues = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `  ${path}: ${issue.message}`;
  });
  if (error.issues.length > limit) {
    issues.push(`  ... and ${error.issues.length - limit} more issue(s) (truncated)`);
  }
  return issues;
}

/**
 * Parse already-read JSON text against the persisted comments schema, with
 * the same actionable DunkUserError messages the public read uses. Extracted
 * so the optimistic-write loop can hash + parse the exact same bytes instead
 * of reading the file twice (which would race a concurrent writer).
 */
function parseCommentsFile(raw: string, path: string): CommentsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DunkUserError(`Malformed JSON in ${path}: ${detail}`, [
      "Repair the file by hand, or delete it to start fresh — dunk recreates an empty one on the next write.",
    ]);
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "schema" in parsed &&
    parsed.schema !== SCHEMA_VERSION
  ) {
    throw new DunkUserError(
      `Unsupported dunk comments schema ${(parsed as { schema: unknown }).schema} at ${path} (expected ${SCHEMA_VERSION}).`,
    );
  }

  const result = CommentsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new DunkUserError(`Invalid comment in ${path}:`, [
      ...summarizeCommentsValidationIssues(result.error),
      "Fix the offending entry (or remove it). Silently dropping bad entries would hide data loss, so the read refuses to continue.",
    ]);
  }
  return result.data;
}

/** Read `.dunk/comments.json` from the repo root, returning [] if missing. */
export function readCommentsFile(repoRoot: string): CommentsFile {
  const path = join(repoRoot, DUNK_DIR, DUNK_COMMENTS_FILENAME);
  if (!existsSync(path)) {
    return { schema: SCHEMA_VERSION, comments: [] };
  }
  return parseCommentsFile(readFileSync(path, "utf8"), path);
}

/** Atomically write the comments file using a unique temp + rename. */
export function writeCommentsFile(repoRoot: string, file: CommentsFile): void {
  const dir = join(repoRoot, DUNK_DIR);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, DUNK_COMMENTS_FILENAME);
  // Unique per-write temp filename so two writers (TUI + agent CLI) never
  // collide on the same `.tmp` and double-rename through it. Same-filesystem
  // rename remains atomic, so concurrent readers still see one whole file.
  const tempPath = join(
    dir,
    `.${DUNK_COMMENTS_FILENAME}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  const sorted: CommentsFile = {
    schema: SCHEMA_VERSION,
    comments: [...file.comments].sort((a, b) => a.id - b.id),
  };
  writeFileSync(tempPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
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

    if (computeAnchor(lines, comment.line) === comment.anchor) {
      return { ...comment, state: "anchored" } as AnchoredComment;
    }

    // Bounded fuzzy relocation: a small neighbor edit (whitespace, a comment
    // change one row above) is enough to invalidate the anchor hash even
    // though the targeted line is still right there. Walk a 20-line window
    // around the recorded position; if exactly one nearby line hashes to
    // the original anchor, re-pin to it instead of declaring drift.
    const relocatedLine = relocateAnchor(lines, comment.line, comment.anchor);
    if (relocatedLine !== null) {
      // Shift the recorded hunk range by the same delta so `dunk comments
      // show` and the renderer mark the relocated lines, not the stale ones.
      // If the shift would push the range off either end of the file, we
      // can't represent it honestly — declare drift instead of returning an
      // anchored comment whose range is inconsistent with its line.
      const delta = relocatedLine - comment.line;
      const shiftedRange: LineRange = [comment.range[0] + delta, comment.range[1] + delta];
      if (shiftedRange[0] >= 1 && shiftedRange[1] <= lines.length) {
        return {
          ...comment,
          line: relocatedLine,
          range: shiftedRange,
          state: "anchored",
        } as AnchoredComment;
      }
    }

    return { ...comment, state: "drifted", reason: "anchor-mismatch" } as DriftedComment;
  });
}

/**
 * Try to locate a unique line within ±RELOCATE_RADIUS of `originalLine` whose
 * surrounding context hashes to the original anchor. Returns the matched line
 * number or null if zero or more than one candidate matches.
 *
 * Keeping the match unique avoids re-pinning to the wrong copy when a file
 * has near-duplicate lines (e.g., several `};` close-braces nearby).
 */
function relocateAnchor(lines: string[], originalLine: number, anchor: string): number | null {
  const RELOCATE_RADIUS = 10;
  const lo = Math.max(1, originalLine - RELOCATE_RADIUS);
  const hi = Math.min(lines.length, originalLine + RELOCATE_RADIUS);

  let matchedLine: number | null = null;
  for (let candidate = lo; candidate <= hi; candidate += 1) {
    if (candidate === originalLine) {
      continue;
    }
    if (computeAnchor(lines, candidate) === anchor) {
      if (matchedLine !== null) {
        // Multiple matches — ambiguous, refuse to guess.
        return null;
      }
      matchedLine = candidate;
    }
  }
  return matchedLine;
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
 *
 * Second-pass drift detection: an anchored comment whose `line` doesn't
 * fall inside any current diff hunk for its file is downgraded to
 * `drifted: not-in-hunk`. Without this guard, a comment that anchored
 * cleanly against a line whose surrounding diff has resolved (the file
 * still has the line, but the hunk it lived in is gone) would render
 * nowhere — invisible to the reviewer.
 */
export function applyCommentsToChangeset(
  changeset: Changeset,
  resolved: ResolvedComment[],
): { changeset: Changeset; drifted: DriftedComment[] } {
  const filesByPath = new Map<string, DiffFile>();
  for (const file of changeset.files) {
    filesByPath.set(file.path, file);
    if (file.previousPath) {
      filesByPath.set(file.previousPath, file);
    }
  }

  const anchoredByPath = new Map<string, AnchoredComment[]>();
  const drifted: DriftedComment[] = [];

  for (const comment of resolved) {
    if (comment.state === "drifted") {
      drifted.push(comment);
      continue;
    }

    const owningFile = filesByPath.get(comment.file);
    if (!owningFile) {
      // `resolveComments` already maps file-missing comments to drifted; if
      // we still see an anchored comment whose file isn't in the changeset
      // (e.g., the file exists on disk but isn't part of the active diff),
      // surface it as drifted rather than rendering it nowhere.
      drifted.push({ ...comment, state: "drifted", reason: "not-in-hunk" });
      continue;
    }

    if (!lineFallsInAnyHunk(owningFile, comment.line)) {
      drifted.push({ ...comment, state: "drifted", reason: "not-in-hunk" });
      continue;
    }

    const list = anchoredByPath.get(comment.file) ?? [];
    list.push(comment);
    anchoredByPath.set(comment.file, list);
  }

  const files = changeset.files.map((file) => mergeFileAnnotations(file, anchoredByPath));
  return {
    changeset: { ...changeset, files },
    drifted,
  };
}

/** Return whether `line` (post-image) falls inside any of the file's current diff hunks. */
function lineFallsInAnyHunk(file: DiffFile, line: number): boolean {
  for (const hunk of file.metadata.hunks) {
    const [start, end] = hunkLineRange(hunk).newRange;
    if (line >= start && line <= end) {
      return true;
    }
  }
  return false;
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
  postLineRange: LineRange,
): PersistedComment[] {
  const [start, end] = postLineRange;
  return comments.filter(
    (comment) => comment.file === filePath && comment.line >= start && comment.line <= end,
  );
}

/** Maximum optimistic-retry attempts before we give up on a concurrent writer. */
const MUTATE_MAX_ATTEMPTS = 5;

/**
 * Snapshot of the current `.dunk/comments.json` with a content fingerprint.
 * Reads the file exactly once and uses the same bytes for both the schema
 * parse and the SHA hash, so a concurrent writer landing between the two
 * can't make the optimistic-write loop hash and validate different content.
 */
function readCommentsFileWithFingerprint(repoRoot: string): {
  file: CommentsFile;
  fingerprint: string | null;
} {
  const path = join(repoRoot, DUNK_DIR, DUNK_COMMENTS_FILENAME);
  if (!existsSync(path)) {
    return { file: { schema: SCHEMA_VERSION, comments: [] }, fingerprint: null };
  }

  const raw = readFileSync(path, "utf8");
  return {
    file: parseCommentsFile(raw, path),
    fingerprint: createHash("sha256").update(raw).digest("hex"),
  };
}

/** Compute the on-disk fingerprint for one comments file, or null if absent. */
function currentFingerprint(repoRoot: string): string | null {
  const path = join(repoRoot, DUNK_DIR, DUNK_COMMENTS_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
}

/**
 * Read, mutate, write the comments file with optimistic concurrency. Re-reads
 * if a concurrent writer (TUI + agent CLI both editing) changed the file
 * between the load and the rename. The `mutate` callback may run more than
 * once — keep it pure.
 */
export function mutateCommentsFile(
  repoRoot: string,
  mutate: (current: CommentsFile) => CommentsFile,
): CommentsFile {
  for (let attempt = 0; attempt < MUTATE_MAX_ATTEMPTS; attempt += 1) {
    const { file: current, fingerprint } = readCommentsFileWithFingerprint(repoRoot);
    const next = mutate(current);
    // Skip the write when the mutation was a no-op so we don't materialize an
    // empty .dunk/comments.json on disk just because the user pressed a delete
    // key on a hunk that has no comments.
    if (next === current) {
      return current;
    }

    // Re-check the fingerprint just before renaming — if a concurrent writer
    // landed in the meantime, restart the read/mutate cycle so their update
    // doesn't get clobbered.
    if (currentFingerprint(repoRoot) !== fingerprint) {
      continue;
    }

    writeCommentsFile(repoRoot, next);
    return next;
  }

  throw new Error(
    `dunk comments: gave up after ${MUTATE_MAX_ATTEMPTS} optimistic retries on ${join(repoRoot, DUNK_DIR, DUNK_COMMENTS_FILENAME)}.`,
  );
}
