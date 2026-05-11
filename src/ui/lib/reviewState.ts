/**
 * Pure review-stream derivation helpers used by `useReviewController`.
 *
 * Turns raw diff files plus filter text into the visible review state, sidebar
 * entries, and hunk cursors. Stays side-effect free so selection and navigation
 * rules can be shared and tested without React state in the loop.
 */
import type { DiffFile } from "../../core/types";
import { buildSidebarEntries, filterReviewFiles, type SidebarEntry } from "./files";
import {
  buildAnnotatedHunkCursors,
  buildHunkCursors,
  indexHunkCursors,
  type HunkCursor,
} from "./hunks";

export interface BuildReviewStreamOptions {
  files: DiffFile[];
  filterQuery: string;
}

export interface ReviewStream {
  allFiles: DiffFile[];
  visibleFiles: DiffFile[];
  sidebarEntries: SidebarEntry[];
  hunkCursors: HunkCursor[];
  hunkCursorIndex: Map<string, number>;
  annotatedHunkCursors: HunkCursor[];
  annotatedHunkCursorIndex: Map<string, number>;
}

/**
 * Stream-only review derivations: filter, sidebar, and cursor lists.
 *
 * Selection (selectedFile / selectedHunk) is intentionally derived elsewhere
 * so a hunk-navigation keypress does not invalidate the memo and rebuild this
 * whole bundle.
 */
export function buildReviewStream({ files, filterQuery }: BuildReviewStreamOptions): ReviewStream {
  const allFiles = files;
  const visibleFiles = filterReviewFiles(allFiles, filterQuery);
  const hunkCursors = buildHunkCursors(visibleFiles);
  const annotatedHunkCursors = buildAnnotatedHunkCursors(visibleFiles);

  return {
    allFiles,
    visibleFiles,
    sidebarEntries: buildSidebarEntries(visibleFiles),
    hunkCursors,
    hunkCursorIndex: indexHunkCursors(hunkCursors),
    annotatedHunkCursors,
    annotatedHunkCursorIndex: indexHunkCursors(annotatedHunkCursors),
  };
}

/** Resolve the selected file using the visible stream first, then the hidden current selection. */
export function resolveSelectedFile(
  allFiles: DiffFile[],
  visibleFiles: DiffFile[],
  selectedFileId: string,
) {
  return (
    visibleFiles.find((file) => file.id === selectedFileId) ??
    allFiles.find((file) => file.id === selectedFileId) ??
    visibleFiles[0]
  );
}

/** Find the next or previous annotated file in the current visible review stream. */
export function findNextAnnotatedFile(
  visibleFiles: DiffFile[],
  currentFileId: string | undefined,
  delta: number,
) {
  const annotatedFiles = visibleFiles.filter((file) => file.annotations.length > 0);
  if (annotatedFiles.length === 0) {
    return null;
  }

  const currentIndex = annotatedFiles.findIndex((file) => file.id === currentFileId);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + delta + annotatedFiles.length) % annotatedFiles.length;
  return annotatedFiles[nextIndex] ?? null;
}
