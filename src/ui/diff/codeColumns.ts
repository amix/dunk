import type { DiffFile, LayoutMode } from "../../core/types";

export const DIFF_CODE_TAB_WIDTH = 2;
export const DIFF_RAIL_PREFIX_WIDTH = 1;
export const DIFF_SPLIT_SEPARATOR_WIDTH = 1;

/** Expand tabs the same way the diff renderer does before measuring visible columns. */
export function expandDiffTabs(text: string) {
  return text.replaceAll("\t", " ".repeat(DIFF_CODE_TAB_WIDTH));
}

/** Measure one rendered code line after tab expansion and newline trimming, without allocating an expanded string. */
export function measureRenderedCodeLineWidth(line: string | undefined) {
  if (!line) {
    return 0;
  }

  let width = 0;
  let end = line.length;
  if (end > 0 && line.charCodeAt(end - 1) === 10) {
    end -= 1;
  }

  for (let index = 0; index < end; index += 1) {
    width += line.charCodeAt(index) === 9 ? DIFF_CODE_TAB_WIDTH : 1;
  }

  return width;
}

// Cache one max-width per file. WeakMap so DiffFiles released by a reload
// drop their cached width without an explicit invalidation hook.
const FILE_MAX_LINE_WIDTHS = new WeakMap<DiffFile, number>();

/** Track the widest rendered code line for one file (cached per DiffFile identity). */
export function maxFileCodeLineWidth(file: DiffFile) {
  const cached = FILE_MAX_LINE_WIDTHS.get(file);
  if (cached !== undefined) {
    return cached;
  }

  let maxWidth = 0;
  for (const line of file.metadata.deletionLines ?? []) {
    const width = measureRenderedCodeLineWidth(line);
    if (width > maxWidth) maxWidth = width;
  }
  for (const line of file.metadata.additionLines ?? []) {
    const width = measureRenderedCodeLineWidth(line);
    if (width > maxWidth) maxWidth = width;
  }

  FILE_MAX_LINE_WIDTHS.set(file, maxWidth);
  return maxWidth;
}

/** Find the widest line-number gutter needed for one file. */
export function findMaxLineNumber(file: DiffFile) {
  let highest = 0;

  for (const hunk of file.metadata.hunks) {
    highest = Math.max(
      highest,
      hunk.deletionStart + hunk.deletionCount,
      hunk.additionStart + hunk.additionCount,
    );
  }

  return Math.max(highest, 1);
}

/** Split-view panes reserve one rail column on the left and one separator column in the middle. */
export function resolveSplitPaneWidths(width: number) {
  const usableWidth = Math.max(0, width - DIFF_RAIL_PREFIX_WIDTH - DIFF_SPLIT_SEPARATOR_WIDTH);
  const leftWidth = Math.max(0, DIFF_RAIL_PREFIX_WIDTH + Math.floor(usableWidth / 2));
  const rightWidth = Math.max(
    0,
    DIFF_SPLIT_SEPARATOR_WIDTH + usableWidth - Math.floor(usableWidth / 2),
  );

  return { leftWidth, rightWidth };
}

/** Resolve the split-cell gutter and code viewport after the rail prefix. */
export function resolveSplitCellGeometry(
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  prefixWidth = DIFF_RAIL_PREFIX_WIDTH,
) {
  const availableWidth = Math.max(0, width - prefixWidth);
  const gutterWidth = Math.min(availableWidth, showLineNumbers ? lineNumberDigits + 3 : 2);

  return {
    gutterWidth,
    contentWidth: Math.max(0, availableWidth - gutterWidth),
  };
}

/** Resolve the stack-cell gutter and code viewport after the left rail prefix. */
export function resolveStackCellGeometry(
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  prefixWidth = DIFF_RAIL_PREFIX_WIDTH,
) {
  const availableWidth = Math.max(0, width - prefixWidth);
  const gutterWidth = Math.min(availableWidth, showLineNumbers ? lineNumberDigits * 2 + 5 : 2);

  return {
    gutterWidth,
    contentWidth: Math.max(0, availableWidth - gutterWidth),
  };
}

/** Clamp horizontal reveal against the narrowest code viewport in the active layout. */
export function resolveCodeViewportWidth(
  layout: Exclude<LayoutMode, "auto">,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
) {
  if (layout === "split") {
    const { leftWidth, rightWidth } = resolveSplitPaneWidths(width);
    return Math.min(
      resolveSplitCellGeometry(leftWidth, lineNumberDigits, showLineNumbers).contentWidth,
      resolveSplitCellGeometry(rightWidth, lineNumberDigits, showLineNumbers).contentWidth,
    );
  }

  return resolveStackCellGeometry(width, lineNumberDigits, showLineNumbers).contentWidth;
}
