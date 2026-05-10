/**
 * Pure review-stream derivation helpers used by `useReviewController`.
 *
 * Turns raw diff files plus filter text into the visible review state, sidebar
 * entries, and hunk cursors. Stays side-effect free so selection and navigation
 * rules can be shared and tested without React state in the loop.
 */
import type { DiffFile } from "../../core/types";
import { buildSidebarEntries, filterReviewFiles, type SidebarEntry } from "./files";
import { buildAnnotatedHunkCursors, buildHunkCursors, type HunkCursor } from "./hunks";

export interface BuildReviewStateOptions {
  files: DiffFile[];
  filterQuery: string;
  selectedFileId: string;
  selectedHunkIndex: number;
}

export interface ReviewState {
  allFiles: DiffFile[];
  visibleFiles: DiffFile[];
  sidebarEntries: SidebarEntry[];
  selectedFile: DiffFile | undefined;
  selectedHunk: DiffFile["metadata"]["hunks"][number] | undefined;
  hunkCursors: HunkCursor[];
  annotatedHunkCursors: HunkCursor[];
}

/** Build the derived review stream state from files, filter text, and selection. */
export function buildReviewState({
  files,
  filterQuery,
  selectedFileId,
  selectedHunkIndex,
}: BuildReviewStateOptions): ReviewState {
  const allFiles = files;
  const visibleFiles = filterReviewFiles(allFiles, filterQuery);
  const selectedFile = resolveSelectedFile(allFiles, visibleFiles, selectedFileId);

  return {
    allFiles,
    visibleFiles,
    sidebarEntries: buildSidebarEntries(visibleFiles),
    selectedFile,
    selectedHunk: selectedFile?.metadata.hunks[selectedHunkIndex],
    hunkCursors: buildHunkCursors(visibleFiles),
    annotatedHunkCursors: buildAnnotatedHunkCursors(visibleFiles),
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
  const annotatedFiles = visibleFiles.filter((file) => file.annotations);
  if (annotatedFiles.length === 0) {
    return null;
  }

  const currentIndex = annotatedFiles.findIndex((file) => file.id === currentFileId);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + delta + annotatedFiles.length) % annotatedFiles.length;
  return annotatedFiles[nextIndex] ?? null;
}
