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
import {
  buildReviewStream,
  findNextAnnotatedFile,
  resolveSelectedFile,
  type ReviewStream,
} from "../lib/reviewState";

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
  moveToFile: (delta: number) => void;
  moveToHunk: (delta: number) => void;
  scrollToNote: boolean;
  selectedFile: DiffFile | undefined;
  selectedFileId: string;
  selectedFileTopAlignRequestId: number;
  selectedHunkRevealRequestId: number;
  selectedHunk: DiffFile["metadata"]["hunks"][number] | undefined;
  selectedHunkIndex: number;
  sidebarEntries: ReviewStream["sidebarEntries"];
  visibleFiles: DiffFile[];
  clearFilter: () => void;
  selectFile: (fileId: string, nextHunkIndex?: number, options?: ReviewSelectionOptions) => void;
  selectFirstHunk: () => void;
  selectHunk: (fileId: string, hunkIndex: number, options?: ReviewSelectionOptions) => void;
  selectLastHunk: () => void;
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

  // Stream-only memo. Hunk-navigation keypresses change selectedFileId /
  // selectedHunkIndex, but the stream depends on neither, so J/K stops
  // re-running filter, sidebar, and cursor builds on every keystroke.
  const {
    allFiles,
    visibleFiles,
    sidebarEntries,
    hunkCursors,
    hunkCursorIndex,
    annotatedHunkCursors,
    annotatedHunkCursorIndex,
  } = useMemo(
    () => buildReviewStream({ files, filterQuery: deferredFilter }),
    [deferredFilter, files],
  );

  const selectedFile = useMemo(
    () => resolveSelectedFile(allFiles, visibleFiles, selectedFileId),
    [allFiles, selectedFileId, visibleFiles],
  );
  const selectedHunk = selectedFile?.metadata.hunks[selectedHunkIndex];

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
        hunkCursorIndex,
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
    [hunkCursorIndex, hunkCursors, selectHunk, selectedFile?.id, selectedHunkIndex],
  );

  /** Jump straight to the first hunk in the review stream (vim `gg`). */
  const selectFirstHunk = useCallback(() => {
    const first = hunkCursors[0];
    if (!first) {
      return;
    }
    selectHunk(first.fileId, first.hunkIndex, {
      alignFileHeaderTop: first.fileId !== selectedFile?.id,
    });
  }, [hunkCursors, selectHunk, selectedFile?.id]);

  /** Jump straight to the last hunk in the review stream (vim `G`). */
  const selectLastHunk = useCallback(() => {
    const last = hunkCursors[hunkCursors.length - 1];
    if (!last) {
      return;
    }
    selectHunk(last.fileId, last.hunkIndex);
  }, [hunkCursors, selectHunk]);

  /** Move through only hunks that currently have inline comments. */
  const moveToAnnotatedHunk = useCallback(
    (delta: number) => {
      const nextCursor = findNextHunkCursor(
        annotatedHunkCursors,
        annotatedHunkCursorIndex,
        selectedFile?.id,
        selectedHunkIndex,
        delta,
        hunkCursors,
      );
      if (!nextCursor) {
        return;
      }

      selectHunk(nextCursor.fileId, nextCursor.hunkIndex, { scrollToNote: true });
    },
    [
      annotatedHunkCursorIndex,
      annotatedHunkCursors,
      hunkCursors,
      selectHunk,
      selectedFile?.id,
      selectedHunkIndex,
    ],
  );

  /** Step through the visible files one at a time, clamped to the ends. */
  const moveToFile = useCallback(
    (delta: number) => {
      if (visibleFiles.length === 0) {
        return;
      }
      const currentIndex = visibleFiles.findIndex((file) => file.id === selectedFile?.id);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = clamp(baseIndex + delta, 0, visibleFiles.length - 1);
      const nextFile = visibleFiles[nextIndex];
      if (!nextFile || nextFile.id === selectedFile?.id) {
        return;
      }
      // Start the new file at its header so a file jump always lands at the top.
      selectFile(nextFile.id, 0, { alignFileHeaderTop: true });
    },
    [selectFile, selectedFile?.id, visibleFiles],
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
    moveToFile,
    moveToHunk,
    selectFile,
    selectFirstHunk,
    selectHunk,
    selectLastHunk,
    setFilter,
  };
}
