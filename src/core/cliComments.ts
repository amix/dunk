/**
 * `dunk comments` — agent-facing command surface for `.dunk/comments.json`.
 *
 * Provides list/show/resolve commands so agents can inspect and prune review
 * comments without hand-editing the persisted JSON.
 */
import { findRepoRoot } from "./config";
import {
  mutateCommentsFile,
  readCommentsFile,
  readPostImagesForComments,
  resolveComments,
  withRemovedComments,
  type PersistedComment,
  type ResolvedComment,
} from "./comments";
import { DUNK_COMMENTS_RELATIVE_PATH } from "./dunkPaths";
import { DunkUserError } from "./errors";

export type CommentsOutputFormat = "text" | "json";

interface CommentsListOptions {
  cwd?: string;
}

interface CommentsShowOptions extends CommentsListOptions {
  /** Lines of surrounding post-image context to include on either side of the hunk. */
  contextLines?: number;
}

/** Locate the repo root or fail with a clear message agents can act on. */
function requireRepoRoot(cwd?: string): string {
  const repoRoot = findRepoRoot(cwd ?? process.cwd());
  if (!repoRoot) {
    throw new DunkUserError("Not inside a git repository.", [
      "`dunk comments` reads `.dunk/comments.json` from the repo root; run it from inside a checkout.",
    ]);
  }
  return repoRoot;
}

/**
 * Load every persisted comment plus the post-image content map needed to
 * resolve and render them.
 */
function loadResolvedCommentsWithContent(repoRoot: string): {
  resolved: ResolvedComment[];
  contentByPath: Map<string, string | undefined>;
} {
  const file = readCommentsFile(repoRoot);
  if (file.comments.length === 0) {
    return { resolved: [], contentByPath: new Map() };
  }

  const contentByPath = readPostImagesForComments(repoRoot, file.comments);
  return { resolved: resolveComments(file.comments, contentByPath), contentByPath };
}

/** Format `[start, end]` as `start` when collapsed or `start-end` otherwise. */
function formatRange(comment: PersistedComment): string {
  const [start, end] = comment.range;
  return start === end ? `${start}` : `${start}-${end}`;
}

/** Compose a one-line drift suffix or empty string when the comment is anchored. */
function driftSuffix(comment: ResolvedComment): string {
  return comment.state === "drifted" ? `  drifted: ${comment.reason}` : "";
}

/** Indent every body line so multi-line comments line up under the header. */
function indentBody(body: string): string {
  return body
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

/** Render the list view as compact text blocks, one per comment. */
function renderListText(resolved: ResolvedComment[]): string {
  if (resolved.length === 0) {
    return "No pending comments.\n";
  }

  const noun = resolved.length === 1 ? "comment" : "comments";
  const blocks = resolved.map((comment) => {
    const header = `#${comment.id}  ${comment.file}:${formatRange(comment)}${driftSuffix(comment)}`;
    return `${header}\n${indentBody(comment.body)}`;
  });
  return `${resolved.length} ${noun}:\n\n${blocks.join("\n\n")}\n`;
}

/** Strip the `state` machinery from a resolved comment back to raw shape. */
function jsonShape(comment: ResolvedComment) {
  const { state, ...rest } = comment;
  if (state === "drifted") {
    return { ...rest, state, reason: comment.reason } as const;
  }
  return { ...rest, state } as const;
}

/** Render the list view as a stable JSON document agents can pipe through `jq`. */
function renderListJson(resolved: ResolvedComment[]): string {
  return `${JSON.stringify({ schema: 1, comments: resolved.map(jsonShape) }, null, 2)}\n`;
}

/** `dunk comments list` — list every pending comment with drift status. */
export function runCommentsList(
  format: CommentsOutputFormat,
  options: CommentsListOptions = {},
): string {
  const repoRoot = requireRepoRoot(options.cwd);
  const { resolved } = loadResolvedCommentsWithContent(repoRoot);
  return format === "json" ? renderListJson(resolved) : renderListText(resolved);
}

/** Default surrounding-context window for `dunk comments show`. Tuned for LLM legibility. */
const DEFAULT_SHOW_CONTEXT = 10;

/** A single rendered line with its absolute file line number and whether it falls inside the hunk. */
interface ContextLine {
  number: number;
  text: string;
  inRange: boolean;
}

/**
 * Pull hunk lines plus surrounding post-image context from already-read file
 * content. Returns null for unavailable drifted files or out-of-range hunks.
 */
function readHunkWithContext(
  comment: PersistedComment,
  contextLines: number,
  content: string | undefined,
): { lines: ContextLine[]; total: number } | null {
  if (content === undefined) {
    return null;
  }

  // Drop a single trailing newline, but keep the remaining line text exactly
  // as it appears on disk (including indentation and trailing whitespace).
  const trimmedTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
  const all = trimmedTrailingNewline.split("\n");
  const [start, end] = comment.range;
  if (start < 1 || end > all.length) {
    return null;
  }

  const windowStart = Math.max(1, start - contextLines);
  const windowEnd = Math.min(all.length, end + contextLines);
  const lines: ContextLine[] = [];
  for (let n = windowStart; n <= windowEnd; n += 1) {
    lines.push({ number: n, text: all[n - 1]!, inRange: n >= start && n <= end });
  }
  return { lines, total: all.length };
}

/** Render `show` text: header, body, then the hunk + context with the comment range marked `>`. */
function renderShowText(
  comment: ResolvedComment,
  hunk: { lines: ContextLine[]; total: number } | null,
): string {
  const header = `#${comment.id}  ${comment.file}:${formatRange(comment)}${driftSuffix(comment)}`;
  const body = indentBody(comment.body);
  if (!hunk) {
    const note = "    (file unavailable; resolve drift before fixing)";
    return `${header}\n${body}\n\n${note}\n`;
  }

  const lastNumber = hunk.lines[hunk.lines.length - 1]!.number;
  const width = String(lastNumber).length;
  const rendered = hunk.lines
    .map((line) => {
      const marker = line.inRange ? ">" : " ";
      return `  ${marker} ${String(line.number).padStart(width)}  ${line.text}`;
    })
    .join("\n");

  const firstNumber = hunk.lines[0]!.number;
  const beforeElided = firstNumber > 1;
  const afterElided = lastNumber < hunk.total;
  const elision: string[] = [];
  if (beforeElided) {
    elision.push(`  (${firstNumber - 1} earlier line${firstNumber === 2 ? "" : "s"} elided)`);
  }
  const trailing = afterElided
    ? `\n  (${hunk.total - lastNumber} later line${hunk.total - lastNumber === 1 ? "" : "s"} elided)`
    : "";
  const head = elision.length > 0 ? `${elision.join("\n")}\n` : "";
  return `${header}\n${body}\n\n${head}${rendered}${trailing}\n`;
}

/** Render `show` JSON: the same shape as one list entry plus the rendered window. */
function renderShowJson(
  comment: ResolvedComment,
  hunk: { lines: ContextLine[]; total: number } | null,
): string {
  if (!hunk) {
    return `${JSON.stringify({ ...jsonShape(comment), context: null }, null, 2)}\n`;
  }
  const firstNumber = hunk.lines[0]!.number;
  const lastNumber = hunk.lines[hunk.lines.length - 1]!.number;
  const payload = {
    ...jsonShape(comment),
    context: {
      window: [firstNumber, lastNumber] as const,
      total: hunk.total,
      lines: hunk.lines.map((line) => ({
        number: line.number,
        text: line.text,
        inRange: line.inRange,
      })),
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** `dunk comments show <id>` — print one comment with the hunk lines and surrounding context. */
export function runCommentsShow(
  id: number,
  format: CommentsOutputFormat,
  options: CommentsShowOptions = {},
): string {
  const repoRoot = requireRepoRoot(options.cwd);
  const { resolved, contentByPath } = loadResolvedCommentsWithContent(repoRoot);
  const comment = resolved.find((entry) => entry.id === id);
  if (!comment) {
    throw new DunkUserError(`No dunk comment with id ${id}.`, [
      `Run \`dunk comments list\` to see pending ids in ${DUNK_COMMENTS_RELATIVE_PATH}.`,
    ]);
  }

  const contextLines = options.contextLines ?? DEFAULT_SHOW_CONTEXT;
  const hunk = readHunkWithContext(comment, contextLines, contentByPath.get(comment.file));
  return format === "json" ? renderShowJson(comment, hunk) : renderShowText(comment, hunk);
}

/** Format `[1, 2, 7]` as `#1, #2, #7` for friendly resolve output. */
function formatIdList(ids: number[]): string {
  return ids.map((id) => `#${id}`).join(", ");
}

/** `dunk comments resolve <id>...` — atomically remove one or more comments. */
export function runCommentsResolve(ids: number[], options: CommentsListOptions = {}): string {
  if (ids.length === 0) {
    throw new DunkUserError("`dunk comments resolve` requires at least one id.");
  }

  // Reject duplicates up-front so the friendly summary doesn't lie about counts.
  const unique = Array.from(new Set(ids));
  if (unique.length !== ids.length) {
    throw new DunkUserError(`Duplicate ids in \`dunk comments resolve\`: ${formatIdList(ids)}.`);
  }

  const repoRoot = requireRepoRoot(options.cwd);

  // Validate inside the mutation closure so the missing-id check sees the
  // file state we're actually about to write. mutateCommentsFile may re-run
  // this callback after a concurrent writer landed, so an id that was
  // present at first read but already resolved by another process correctly
  // surfaces as "no dunk comment with id" instead of a silent no-op.
  mutateCommentsFile(repoRoot, (file) => {
    const knownIds = new Set(file.comments.map((comment) => comment.id));
    const missing = unique.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      const noun = missing.length === 1 ? "id" : "ids";
      throw new DunkUserError(`No dunk comment with ${noun} ${formatIdList(missing)}.`, [
        "Run `dunk comments list` to see pending ids. No changes were written.",
      ]);
    }
    return withRemovedComments(file, unique);
  });

  const noun = unique.length === 1 ? "comment" : "comments";
  return `Resolved ${unique.length} ${noun}: ${formatIdList(unique)}.\n`;
}

/** Build the `dunk comments` help text shown by bare invocation and `--help`. */
export function renderCommentsHelp(): string {
  return [
    "Usage: dunk comments <subcommand> [options]",
    "",
    "Inspect and resolve review comments stored in `.dunk/comments.json`.",
    "Designed for coding agents driving a review without entering the TUI.",
    "",
    "Subcommands:",
    "  list [--json]                       list every pending comment with drift status",
    "  show <id> [--json] [--context <N>]  print one comment plus the hunk and surrounding code",
    "  resolve <id> [<id>...]              remove one or more comments by id (atomic)",
    "",
    "Bare `dunk comments` is equivalent to `dunk comments list`.",
    "Use `--json` on list/show for a stable machine-readable shape.",
    "`show` defaults to 10 lines of surrounding context; `--context <N>` overrides it.",
    "",
  ].join("\n");
}
