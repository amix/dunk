import type { Annotation } from "../../core/types";
import { annotationAnchor, type VisibleAgentNote } from "../lib/agentAnnotations";
import { diffHunkId } from "../lib/ids";
import type { DiffRow } from "./pierre";

const EMPTY_VISIBLE_AGENT_NOTES: VisibleAgentNote[] = [];

type DiffLineRow = Extract<DiffRow, { type: "split-line" | "stack-line" }>;

interface InlineVisibleNotePlacement {
  anchorKey: string;
  hunkIndex: number;
  note: VisibleAgentNote;
  noteCount: number;
  noteIndex: number;
}

export type PlannedReviewRow =
  | {
      kind: "diff-row";
      key: string;
      stableKey: string;
      stableAliasKeys?: string[];
      fileId: string;
      hunkIndex: number;
      row: DiffRow;
      anchorId?: string;
    }
  | {
      kind: "inline-note";
      key: string;
      stableKey: string;
      fileId: string;
      hunkIndex: number;
      annotationId: string;
      annotation: Annotation;
      noteCount: number;
      noteIndex: number;
    };

function lineRows(rows: DiffRow[]) {
  return rows.filter(
    (row): row is DiffLineRow => row.type === "split-line" || row.type === "stack-line",
  );
}

/** Deduplicate stable row anchors while preserving the preferred resolution order. */
function uniqueStableKeys(keys: Array<string | undefined>) {
  const next: string[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(key);
  }

  return next;
}

/** Build the file-scoped stable anchor for one old-side source line. */
function oldLineStableKey(hunkIndex: number, lineNumber?: number) {
  return lineNumber === undefined ? undefined : `line:${hunkIndex}:old:${lineNumber}`;
}

/** Build the file-scoped stable anchor for one new-side source line. */
function newLineStableKey(hunkIndex: number, lineNumber?: number) {
  return lineNumber === undefined ? undefined : `line:${hunkIndex}:new:${lineNumber}`;
}

/** Build the file-scoped stable anchor for one context row shared by both sides. */
function contextLineStableKey(hunkIndex: number, oldLineNumber?: number, newLineNumber?: number) {
  return oldLineNumber === undefined || newLineNumber === undefined
    ? undefined
    : `line:${hunkIndex}:context:${oldLineNumber}:${newLineNumber}`;
}

/** Resolve the stable anchor keys for one rendered diff row across split and stack layouts. */
function diffRowStableKeys(row: DiffRow) {
  if (row.type === "collapsed") {
    return [
      row.key.endsWith(":trailing")
        ? `meta:collapsed:trailing:${row.hunkIndex}`
        : `meta:collapsed:before:${row.hunkIndex}`,
    ];
  }

  if (row.type === "hunk-header") {
    return [`meta:hunk-header:${row.hunkIndex}`];
  }

  if (row.type === "split-line") {
    const contextKey = contextLineStableKey(
      row.hunkIndex,
      row.left.lineNumber,
      row.right.lineNumber,
    );

    if (row.left.kind === "context" && row.right.kind === "context") {
      return uniqueStableKeys([
        contextKey,
        newLineStableKey(row.hunkIndex, row.right.lineNumber),
        oldLineStableKey(row.hunkIndex, row.left.lineNumber),
      ]);
    }

    // Prefer the old-side line so split→stack toggles stay near the same vertical position even
    // when one large change block expands into many deletions followed by many additions.
    return uniqueStableKeys([
      oldLineStableKey(row.hunkIndex, row.left.lineNumber),
      newLineStableKey(row.hunkIndex, row.right.lineNumber),
    ]);
  }

  if (row.type !== "stack-line") {
    return [`row:${row.key}`];
  }

  const contextKey = contextLineStableKey(
    row.hunkIndex,
    row.cell.oldLineNumber,
    row.cell.newLineNumber,
  );

  if (row.cell.kind === "context") {
    return uniqueStableKeys([
      contextKey,
      newLineStableKey(row.hunkIndex, row.cell.newLineNumber),
      oldLineStableKey(row.hunkIndex, row.cell.oldLineNumber),
    ]);
  }

  return uniqueStableKeys([
    newLineStableKey(row.hunkIndex, row.cell.newLineNumber),
    oldLineStableKey(row.hunkIndex, row.cell.oldLineNumber),
  ]);
}

/** Read the old-side line number from a rendered diff row, or null if absent. */
function rowOldLineNumber(row: DiffLineRow) {
  const value = row.type === "split-line" ? row.left.lineNumber : row.cell.oldLineNumber;
  return value ?? null;
}

/** Read the new-side line number from a rendered diff row, or null if absent. */
function rowNewLineNumber(row: DiffLineRow) {
  const value = row.type === "split-line" ? row.right.lineNumber : row.cell.newLineNumber;
  return value ?? null;
}

/** Index of file line rows keyed by side and line number for O(1) annotation lookup. */
interface LineRowIndex {
  rows: DiffLineRow[];
  byOldLine: Map<number, DiffLineRow>;
  byNewLine: Map<number, DiffLineRow>;
  /** Last line row of every hunk, so notes can anchor at the hunk's bottom. */
  lastLineRowByHunk: Map<number, DiffLineRow>;
  // Render-order position per row identity so covered-row collections can sort
  // without an O(n) indexOf on every comparison.
  positionByKey: Map<string, number>;
  firstHeaderRow: DiffRow | undefined;
}

/** Pre-index file line rows once so per-note anchor + overlap lookups don't rescan. */
function buildLineRowIndex(rows: DiffRow[]): LineRowIndex {
  const lineRowsList = lineRows(rows);
  const byOldLine = new Map<number, DiffLineRow>();
  const byNewLine = new Map<number, DiffLineRow>();
  const lastLineRowByHunk = new Map<number, DiffLineRow>();
  const positionByKey = new Map<string, number>();

  lineRowsList.forEach((row, position) => {
    positionByKey.set(row.key, position);
    lastLineRowByHunk.set(row.hunkIndex, row);
    const oldLine = rowOldLineNumber(row);
    if (oldLine !== null && !byOldLine.has(oldLine)) {
      byOldLine.set(oldLine, row);
    }
    const newLine = rowNewLineNumber(row);
    if (newLine !== null && !byNewLine.has(newLine)) {
      byNewLine.set(newLine, row);
    }
  });

  return {
    rows: lineRowsList,
    byOldLine,
    byNewLine,
    lastLineRowByHunk,
    positionByKey,
    firstHeaderRow: rows.find((row) => row.type === "hunk-header"),
  };
}

/**
 * Resolve the rendered diff row before which the inline note should appear.
 * Range-less notes intentionally anchor beside the first code row in the file,
 * Range-less notes fall back to the first visible line row.
 */
function resolveNoteHunkAnchor(
  index: LineRowIndex,
  annotation: Annotation,
): DiffLineRow | DiffRow | undefined {
  const anchor = annotationAnchor(annotation);
  if (anchor) {
    const map = anchor.side === "new" ? index.byNewLine : index.byOldLine;
    const hit = map.get(anchor.lineNumber);
    if (hit) {
      return hit;
    }
  }

  return index.rows[0] ?? index.firstHeaderRow;
}

function buildInlineVisibleNotePlacements(rows: DiffRow[], visibleAgentNotes: VisibleAgentNote[]) {
  const placementsByAfterKey = new Map<string, InlineVisibleNotePlacement[]>();
  if (visibleAgentNotes.length === 0) {
    return placementsByAfterKey;
  }

  const index = buildLineRowIndex(rows);

  for (const note of visibleAgentNotes) {
    // Map the annotation to its owning hunk so the card can dock at the
    // hunk's last line row. Comments are always hunk-anchored, so we don't
    // try to highlight a sub-range or dock per-side.
    const fallbackAnchorRow = resolveNoteHunkAnchor(index, note.annotation);
    if (!fallbackAnchorRow) {
      continue;
    }

    const hunkIndex = fallbackAnchorRow.hunkIndex;
    const cardAnchorRow = index.lastLineRowByHunk.get(hunkIndex) ?? fallbackAnchorRow;
    const anchorPlacements = placementsByAfterKey.get(cardAnchorRow.key) ?? [];

    anchorPlacements.push({
      anchorKey: cardAnchorRow.key,
      hunkIndex,
      note,
      noteCount: 1,
      noteIndex: 0,
    });
    placementsByAfterKey.set(cardAnchorRow.key, anchorPlacements);
  }

  for (const placements of placementsByAfterKey.values()) {
    placements.forEach((placement, position) => {
      placement.noteIndex = position;
      placement.noteCount = placements.length;
    });
  }

  return placementsByAfterKey;
}

function rowCanAnchorHunk(row: DiffRow, showHunkHeaders: boolean) {
  if (showHunkHeaders) {
    return row.type === "hunk-header";
  }

  return row.type !== "collapsed" && row.type !== "hunk-header";
}

/**
 * Build the explicit presentational row plan for one file diff body.
 * The plan always preserves diff-row order and may insert inline notes plus
 * trailing guide caps for every visible note anchored in this file.
 */
export function buildReviewRenderPlan({
  fileId,
  rows,
  showHunkHeaders,
  visibleAgentNotes = EMPTY_VISIBLE_AGENT_NOTES,
  selectedHunkIndex: _selectedHunkIndex,
}: {
  fileId: string;
  rows: DiffRow[];
  showHunkHeaders: boolean;
  visibleAgentNotes?: VisibleAgentNote[];
  selectedHunkIndex?: number;
}) {
  const placementsByAfterKey = buildInlineVisibleNotePlacements(rows, visibleAgentNotes);
  const plannedRows: PlannedReviewRow[] = [];
  const anchoredHunks = new Set<number>();

  for (const row of rows) {
    const shouldAnchorHunk =
      rowCanAnchorHunk(row, showHunkHeaders) && !anchoredHunks.has(row.hunkIndex);
    const anchorId = shouldAnchorHunk ? diffHunkId(fileId, row.hunkIndex) : undefined;
    const diffStableKeys = diffRowStableKeys(row);
    const diffStableKey = diffStableKeys[0] ?? `row:${row.key}`;
    const diffStableAliasKeys = diffStableKeys.slice(1);

    if (shouldAnchorHunk) {
      anchoredHunks.add(row.hunkIndex);
    }

    plannedRows.push({
      kind: "diff-row",
      key: `diff-row:${row.key}`,
      stableKey: diffStableKey,
      stableAliasKeys: diffStableAliasKeys,
      fileId: row.fileId,
      hunkIndex: row.hunkIndex,
      row,
      anchorId,
    });

    // Notes are anchored after the hunk's last line row, not before it: the
    // card sits at the bottom of every hunk so its position is predictable
    // regardless of which line is annotated.
    const notesAfterThisRow = placementsByAfterKey.get(row.key) ?? [];
    notesAfterThisRow.forEach((placement) => {
      plannedRows.push({
        kind: "inline-note",
        key: `inline-note:${placement.note.id}:${row.key}:${placement.noteIndex}`,
        stableKey: `inline-note:${placement.note.id}`,
        fileId,
        hunkIndex: placement.hunkIndex,
        annotationId: placement.note.id,
        annotation: placement.note.annotation,
        noteCount: placement.noteCount,
        noteIndex: placement.noteIndex,
      });
    });
  }

  return plannedRows;
}
