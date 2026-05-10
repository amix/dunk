/**
 * Shared review-stream state for the app shell.
 *
 * Owns: filtering, selected file and hunk, and relative review navigation.
 * `App` uses it for rendering and keyboard actions.
 */
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { DiffFile } from "../../core/types";
import { findNextHunkCursor } from "../lib/hunks";
import { buildReviewState, findNextAnnotatedFile, type ReviewState } from "../lib/reviewState";

/** Clamp one numeric index into an inclusive range. */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export interface ReviewSelectionOptions {
  alignFileHeaderTop?: boolean;
  preserveViewport?: boolean;
  scrollToNote?: boolean;
}

export interface ReviewController {
  allFiles: DiffFile[];
  filter: string;
  moveToAnnotatedFile: (delta: number) => void;
  moveToAnnotatedHunk: (delta: number) => void;
  moveToHunk: (delta: number) => void;
  scrollToNote: boolean;
  selectedFile: DiffFile | undefined;
  selectedFileId: string;
  selectedFileTopAlignRequestId: number;
  selectedHunkRevealRequestId: number;
  selectedHunk: DiffFile["metadata"]["hunks"][number] | undefined;
  selectedHunkIndex: number;
  sidebarEntries: ReviewState["sidebarEntries"];
  visibleFiles: DiffFile[];
  clearFilter: () => void;
  selectFile: (fileId: string, nextHunkIndex?: number, options?: ReviewSelectionOptions) => void;
  selectHunk: (fileId: string, hunkIndex: number, options?: ReviewSelectionOptions) => void;
  setFilter: (value: string) => void;
}

/** Own the shared review stream state for the UI shell. */
export function useReviewController({ files }: { files: DiffFile[] }): ReviewController {
  const [filter, setFilter] = useState("");
  const [selectedFileId, setSelectedFileId] = useState(files[0]?.id ?? "");
  const [selectedHunkIndex, setSelectedHunkIndex] = useState(0);
  const [selectedFileTopAlignRequestId, setSelectedFileTopAlignRequestId] = useState(0);
  const [selectedHunkRevealRequestId, setSelectedHunkRevealRequestId] = useState(0);
  const [scrollToNote, setScrollToNote] = useState(false);
  const deferredFilter = useDeferredValue(filter);

  const {
    allFiles,
    visibleFiles,
    sidebarEntries,
    selectedFile,
    selectedHunk,
    hunkCursors,
    annotatedHunkCursors,
  } = useMemo(
    () =>
      buildReviewState({
        files,
        filterQuery: deferredFilter,
        selectedFileId,
        selectedHunkIndex,
      }),
    [deferredFilter, files, selectedFileId, selectedHunkIndex],
  );

  /** Update the selection and reveal intent together so diff scrolling stays explicit. */
  const selectHunk = useCallback(
    (fileId: string, hunkIndex: number, options?: ReviewSelectionOptions) => {
      setSelectedFileId(fileId);
      setSelectedHunkIndex(hunkIndex);
      setScrollToNote(Boolean(options?.scrollToNote));

      if (options?.alignFileHeaderTop) {
        setSelectedFileTopAlignRequestId((current) => current + 1);
        return;
      }

      if (!options?.preserveViewport) {
        setSelectedHunkRevealRequestId((current) => current + 1);
      }
    },
    [],
  );

  /** Select one file and optionally one specific hunk within it. */
  const selectFile = useCallback(
    (fileId: string, nextHunkIndex = 0, options?: ReviewSelectionOptions) => {
      selectHunk(fileId, nextHunkIndex, options);
    },
    [selectHunk],
  );

  /** Reset selection to the first visible file when the current target disappears from the review stream. */
  const reselectFirstVisibleFile = useCallback(() => {
    startTransition(() => {
      setSelectedFileId(visibleFiles[0]!.id);
      setSelectedHunkIndex(0);
    });
  }, [visibleFiles]);

  /** Keep the selected file anchored to the current visible review stream as filters and reloads change it. */
  const reconcileSelectedFile = useCallback(() => {
    if (visibleFiles.length === 0) {
      return;
    }

    if (!selectedFileId || !allFiles.some((file) => file.id === selectedFileId)) {
      reselectFirstVisibleFile();
      return;
    }

    if (selectedFile && !visibleFiles.some((file) => file.id === selectedFile.id)) {
      reselectFirstVisibleFile();
    }
  }, [allFiles, reselectFirstVisibleFile, selectedFile, selectedFileId, visibleFiles]);

  /** Clamp the selected hunk index after reloads or filter changes shrink the selected file's hunk list. */
  const reconcileSelectedHunkIndex = useCallback(() => {
    if (!selectedFile) {
      return;
    }

    const maxIndex = Math.max(0, selectedFile.metadata.hunks.length - 1);
    setSelectedHunkIndex((current) => clamp(current, 0, maxIndex));
  }, [selectedFile]);

  useEffect(() => {
    reconcileSelectedFile();
  }, [reconcileSelectedFile]);

  useEffect(() => {
    reconcileSelectedHunkIndex();
  }, [reconcileSelectedHunkIndex]);

  /** Move through the full visible review stream one hunk at a time. */
  const moveToHunk = useCallback(
    (delta: number) => {
      const nextCursor = findNextHunkCursor(
        hunkCursors,
        selectedFile?.id,
        selectedHunkIndex,
        delta,
      );
      if (!nextCursor) {
        return;
      }

      const crossingFileBoundary = nextCursor.fileId !== selectedFile?.id;
      selectHunk(nextCursor.fileId, nextCursor.hunkIndex, {
        // Align the file header to top only for forward cross-file jumps so the new file
        // starts at its header. Backward jumps should reveal the target hunk directly,
        // since the target is often near the bottom of the previous file and the file-top
        // align would require an extra navigation press to reach it.
        alignFileHeaderTop: crossingFileBoundary && delta > 0,
      });
    },
    [hunkCursors, selectHunk, selectedFile?.id, selectedHunkIndex],
  );

  /** Move through only hunks that currently have agent notes. */
  const moveToAnnotatedHunk = useCallback(
    (delta: number) => {
      const nextCursor = findNextHunkCursor(
        annotatedHunkCursors,
        selectedFile?.id,
        selectedHunkIndex,
        delta,
      );
      if (!nextCursor) {
        return;
      }

      selectHunk(nextCursor.fileId, nextCursor.hunkIndex, { scrollToNote: true });
    },
    [annotatedHunkCursors, selectHunk, selectedFile?.id, selectedHunkIndex],
  );

  /** Cycle through only the currently visible files that carry annotations. */
  const moveToAnnotatedFile = useCallback(
    (delta: number) => {
      const nextFile = findNextAnnotatedFile(visibleFiles, selectedFile?.id, delta);
      if (!nextFile) {
        return;
      }

      selectFile(nextFile.id);
    },
    [selectFile, selectedFile?.id, visibleFiles],
  );

  /** Clear the active file filter without touching the current selection. */
  const clearFilter = useCallback(() => {
    setFilter("");
  }, []);

  return {
    allFiles,
    filter,
    scrollToNote,
    selectedFile,
    selectedFileId,
    selectedFileTopAlignRequestId,
    selectedHunkRevealRequestId,
    selectedHunk,
    selectedHunkIndex,
    sidebarEntries,
    visibleFiles,
    clearFilter,
    moveToAnnotatedFile,
    moveToAnnotatedHunk,
    moveToHunk,
    selectFile,
    selectHunk,
    setFilter,
  };
}
