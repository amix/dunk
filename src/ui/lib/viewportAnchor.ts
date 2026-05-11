import type { DiffFile } from "../../core/types";
import type { DiffSectionGeometry, DiffSectionRowBounds } from "./diffSectionGeometry";
import { buildFileSectionLayouts } from "./fileSectionLayout";

/** Identify the rendered review row that currently owns the viewport top. */
export interface ViewportRowAnchor {
  fileId: string;
  rowKey: string;
  stableKey: string;
  rowOffsetWithin: number;
}

/**
 * Find the index of the measured row whose extent covers one file-relative offset, or `-1`
 * when the offset lies outside every measured row in the section.
 */
function binarySearchRowBoundsIndex(sectionRowBounds: DiffSectionRowBounds[], relativeTop: number) {
  let low = 0;
  let high = sectionRowBounds.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const rowBounds = sectionRowBounds[mid]!;

    if (relativeTop < rowBounds.top) {
      high = mid - 1;
    } else if (relativeTop >= rowBounds.top + rowBounds.height) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}

/** Resolve the nearest neighbouring diff-row to the picked index, preferring the row above. */
function pickNearestDiffRow(sectionRowBounds: DiffSectionRowBounds[], pickedIndex: number) {
  for (let index = pickedIndex - 1; index >= 0; index -= 1) {
    if (sectionRowBounds[index]!.kind === "diff-row") {
      return index;
    }
  }

  for (let index = pickedIndex + 1; index < sectionRowBounds.length; index += 1) {
    if (sectionRowBounds[index]!.kind === "diff-row") {
      return index;
    }
  }

  return pickedIndex;
}

/**
 * Capture a stable top-row anchor from the current review stream.
 *
 * `preferredStableKey` lets callers preserve the exact logical side they were already following
 * when a split row can map to multiple stacked rows and vice versa.
 *
 * `preferDiffRows` biases the picked row toward survivable diff content when the row covering
 * the viewport top is an inline comment card. That keeps the user's reading position attached to
 * code that survives a comment add/edit/delete instead of disappearing with the deleted card.
 */
export function findViewportRowAnchor(
  files: DiffFile[],
  sectionGeometry: DiffSectionGeometry[],
  scrollTop: number,
  headerHeights: number[],
  preferredStableKey?: string | null,
  options?: { preferDiffRows?: boolean },
) {
  const fileSectionLayouts = buildFileSectionLayouts(
    files,
    sectionGeometry.map((metrics) => metrics?.bodyHeight ?? 0),
    headerHeights,
  );

  for (let index = 0; index < files.length; index += 1) {
    const sectionLayout = fileSectionLayouts[index];
    const bodyTop = sectionLayout?.bodyTop ?? 0;
    const geometry = sectionGeometry[index];
    const bodyHeight = geometry?.bodyHeight ?? 0;
    const relativeTop = scrollTop - bodyTop;

    if (relativeTop >= 0 && relativeTop < bodyHeight && geometry) {
      const pickedIndex = binarySearchRowBoundsIndex(geometry.rowBounds, relativeTop);
      if (pickedIndex < 0) {
        continue;
      }

      const initialRow = geometry.rowBounds[pickedIndex]!;
      const chosenIndex =
        options?.preferDiffRows && initialRow.kind === "inline-note"
          ? pickNearestDiffRow(geometry.rowBounds, pickedIndex)
          : pickedIndex;
      const rowBounds = geometry.rowBounds[chosenIndex]!;

      const stableKey =
        preferredStableKey && rowBounds.stableKeys.includes(preferredStableKey)
          ? preferredStableKey
          : rowBounds.stableKey;

      return {
        fileId: files[index]!.id,
        rowKey: rowBounds.key,
        stableKey,
        rowOffsetWithin: relativeTop - rowBounds.top,
      } satisfies ViewportRowAnchor;
    }
  }

  return null;
}

/**
 * Resolve one captured row anchor into its next absolute scrollTop after a relayout.
 * Returns `null` when the file or row no longer exists, so callers can apply a sensible
 * fallback rather than scrolling to the file body top.
 */
export function resolveViewportRowAnchorTop(
  files: DiffFile[],
  sectionGeometry: DiffSectionGeometry[],
  anchor: ViewportRowAnchor,
  headerHeights: number[],
): number | null {
  const fileSectionLayouts = buildFileSectionLayouts(
    files,
    sectionGeometry.map((metrics) => metrics?.bodyHeight ?? 0),
    headerHeights,
  );

  for (let index = 0; index < files.length; index += 1) {
    const sectionLayout = fileSectionLayouts[index];
    const bodyTop = sectionLayout?.bodyTop ?? 0;
    const file = files[index];
    const geometry = sectionGeometry[index];
    if (file?.id !== anchor.fileId || !geometry) {
      continue;
    }

    const rowBounds =
      geometry.rowBoundsByStableKey.get(anchor.stableKey) ??
      geometry.rowBoundsByKey.get(anchor.rowKey);
    if (!rowBounds) {
      return null;
    }

    return (
      bodyTop + rowBounds.top + Math.min(anchor.rowOffsetWithin, Math.max(0, rowBounds.height - 1))
    );
  }

  return null;
}
