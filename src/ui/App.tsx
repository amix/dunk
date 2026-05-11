import {
  MouseButton,
  type MouseEvent as TuiMouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  commentsForHunkRange,
  computeAnchorForFile,
  mutateCommentsFile,
  readCommentsFile as readCommentsFileFromRepo,
  withAddedComment,
  withRemovedComment,
  withRemovedCommentsForFiles,
  type CommentsFile,
  type PersistedComment,
} from "../core/comments";
import { copyToClipboard } from "../core/clipboard";
import { findRepoRoot } from "../core/config";
import { resolveEditorLaunch, runEditorLaunch } from "../core/editor";
import { hunkLineRange } from "../core/hunkRange";
import type { AppBootstrap, CliInput, LayoutMode } from "../core/types";
import { canReloadInput, computeWatchSignature } from "../core/watch";
import { DriftedCommentsBanner } from "./components/chrome/DriftedCommentsBanner";
import { StatusBar } from "./components/chrome/StatusBar";
import { DiffPane } from "./components/panes/DiffPane";
import { SidebarPane } from "./components/panes/SidebarPane";
import { PaneDivider } from "./components/panes/PaneDivider";
import {
  findMaxLineNumber,
  maxFileCodeLineWidth,
  resolveCodeViewportWidth,
} from "./diff/codeColumns";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useReviewController } from "./hooks/useReviewController";
import { fileRowId } from "./lib/ids";
import { resolveResponsiveLayout } from "./lib/responsive";
import { resizeSidebarWidth } from "./lib/sidebar";
import { resolveTheme, THEMES } from "./themes";

type FocusArea = "files" | "filter";

const FAST_CODE_HORIZONTAL_SCROLL_COLUMNS = 8;

const LazyHelpDialog = lazy(async () => ({
  default: (await import("./components/chrome/HelpDialog")).HelpDialog,
}));
const LazyCommentEditor = lazy(async () => ({
  default: (await import("./components/chrome/CommentEditor")).CommentEditor,
}));
const LazyConfirmDialog = lazy(async () => ({
  default: (await import("./components/chrome/ConfirmDialog")).ConfirmDialog,
}));

/** Clamp a value into an inclusive range. */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Preserve the active app view settings when rebuilding the current input. */
function withCurrentViewOptions(
  input: CliInput,
  view: {
    layoutMode: LayoutMode;
    themeId: string;
    showComments: boolean;
    showHunkHeaders: boolean;
    showLineNumbers: boolean;
    wrapLines: boolean;
  },
): CliInput {
  return {
    ...input,
    options: {
      ...input.options,
      mode: view.layoutMode,
      theme: view.themeId,
      comments: view.showComments,
      hunkHeaders: view.showHunkHeaders,
      lineNumbers: view.showLineNumbers,
      wrapLines: view.wrapLines,
    },
  };
}

/** Orchestrate global app state, layout, navigation, and pane coordination. */
export function App({
  bootstrap,
  onQuit = () => process.exit(0),
  onReloadSession,
}: {
  bootstrap: AppBootstrap;
  onQuit?: () => void;
  onReloadSession: (
    nextInput: CliInput,
    options?: { resetApp?: boolean; sourcePath?: string },
  ) => Promise<void>;
}) {
  const SIDEBAR_MIN_WIDTH = 22;
  const DIFF_MIN_WIDTH = 48;
  const BODY_PADDING = 2;
  const DIVIDER_WIDTH = 1;
  const DIVIDER_HIT_WIDTH = 5;

  const pagerMode = Boolean(bootstrap.input.options.pager);
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  // Repo root is invariant for one App mount; resolving it once avoids walking the
  // filesystem on every hunk-action keystroke.
  const repoRoot = useMemo(() => findRepoRoot() ?? null, []);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const wrapToggleScrollTopRef = useRef<number | null>(null);
  const layoutToggleScrollTopRef = useRef<number | null>(null);
  const [layoutToggleRequestId, setLayoutToggleRequestId] = useState(0);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(bootstrap.initialMode);
  const [themeId, setThemeId] = useState(
    () => resolveTheme(bootstrap.initialTheme, renderer.themeMode).id,
  );
  const [showComments, setShowComments] = useState(bootstrap.initialShowComments ?? true);
  const [showLineNumbers, setShowLineNumbers] = useState(bootstrap.initialShowLineNumbers ?? true);
  const [wrapLines, setWrapLines] = useState(bootstrap.initialWrapLines ?? false);
  const [codeHorizontalOffset, setCodeHorizontalOffset] = useState(0);
  const [showHunkHeaders, setShowHunkHeaders] = useState(bootstrap.initialShowHunkHeaders ?? true);
  const [sidebarVisible, setSidebarVisible] = useState(() => !pagerMode);
  const [forceSidebarOpen, setForceSidebarOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // When non-null, hunk navigation (J/K) and the `d` delete key target the
  // drifted-comments banner pinned at the top of the diff instead of a real
  // hunk. Pressing K from the first hunk enters drift focus; J past the last
  // drifted entry exits back into the review stream.
  const [selectedDriftIndex, setSelectedDriftIndex] = useState<number | null>(null);
  const [commentEditorTarget, setCommentEditorTarget] = useState<{
    repoRoot: string;
    filePath: string;
    line: number;
    range: [number, number];
    anchor: string;
  } | null>(null);
  // Hoist the draft body so a reload/remount of the comment editor cannot
  // silently drop in-flight typing. Reset to "" only on open and on cancel/
  // submit; everything else is a pass-through.
  const [commentDraftBody, setCommentDraftBody] = useState("");
  const [confirmPrompt, setConfirmPrompt] = useState<{
    message: string;
    title?: string;
    onConfirm: () => void;
  } | null>(null);
  const [focusArea, setFocusArea] = useState<FocusArea>("files");
  const [sidebarWidth, setSidebarWidth] = useState(34);
  const [resizeDragOriginX, setResizeDragOriginX] = useState<number | null>(null);
  const [resizeStartWidth, setResizeStartWidth] = useState<number | null>(null);
  const [transientStatus, setTransientStatus] = useState<string | null>(null);
  const transientStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionAutoCopy = bootstrap.initialSelectionAutoCopy ?? true;

  const activeTheme = resolveTheme(themeId, renderer.themeMode);
  const review = useReviewController({ files: bootstrap.changeset.files });
  const filteredFiles = review.visibleFiles;
  const selectedFile = review.selectedFile;
  const selectedHunkIndex = review.selectedHunkIndex;
  const moveToAnnotatedHunk = review.moveToAnnotatedHunk;
  const driftedCount = bootstrap.driftedComments?.length ?? 0;

  /**
   * Wrap hunk navigation so drifted comments are addressable just like real
   * hunks. K from the first hunk drops focus into the drifted banner; J past
   * the last drifted entry hands focus back to the first real hunk.
   */
  const moveToHunkWithDrift = useCallback(
    (delta: number) => {
      if (selectedDriftIndex !== null) {
        const next = selectedDriftIndex + delta;
        if (next < 0) {
          setSelectedDriftIndex(0);
          return;
        }
        if (next >= driftedCount) {
          setSelectedDriftIndex(null);
          review.moveToHunk(0);
          return;
        }
        setSelectedDriftIndex(next);
        return;
      }

      // K (delta = -1) from the very first hunk drops into the drifted list.
      if (delta < 0 && driftedCount > 0 && review.selectedHunkIndex === 0) {
        const firstFile = review.visibleFiles[0];
        if (firstFile && review.selectedFile?.id === firstFile.id) {
          setSelectedDriftIndex(driftedCount - 1);
          return;
        }
      }

      review.moveToHunk(delta);
    },
    [driftedCount, review, selectedDriftIndex],
  );

  const jumpToFile = useCallback(
    (fileId: string, nextHunkIndex = 0, options?: { alignFileHeaderTop?: boolean }) => {
      review.selectFile(fileId, nextHunkIndex, {
        alignFileHeaderTop: options?.alignFileHeaderTop,
      });
    },
    [review.selectFile],
  );

  const bodyPadding = pagerMode ? 0 : BODY_PADDING;
  const bodyWidth = Math.max(0, terminal.width - bodyPadding);
  const responsiveLayout = resolveResponsiveLayout(layoutMode, terminal.width);
  const canForceShowSidebar = bodyWidth >= SIDEBAR_MIN_WIDTH + DIVIDER_WIDTH + DIFF_MIN_WIDTH;
  const renderSidebar =
    sidebarVisible && (responsiveLayout.showSidebar || (forceSidebarOpen && canForceShowSidebar));
  const centerWidth = bodyWidth;
  const resolvedLayout = responsiveLayout.layout;
  const availableCenterWidth = renderSidebar
    ? Math.max(0, centerWidth - DIVIDER_WIDTH)
    : Math.max(0, centerWidth);
  const maxSidebarWidth = renderSidebar
    ? Math.max(SIDEBAR_MIN_WIDTH, availableCenterWidth - DIFF_MIN_WIDTH)
    : SIDEBAR_MIN_WIDTH;
  const clampedSidebarWidth = renderSidebar
    ? clamp(sidebarWidth, SIDEBAR_MIN_WIDTH, maxSidebarWidth)
    : 0;
  const diffPaneWidth = renderSidebar
    ? Math.max(DIFF_MIN_WIDTH, availableCenterWidth - clampedSidebarWidth)
    : Math.max(0, availableCenterWidth);
  const diffContentWidth = Math.max(12, diffPaneWidth - 2);
  const maxVisibleLineNumber = useMemo(
    () =>
      filteredFiles.reduce(
        (maxLineNumber, file) => Math.max(maxLineNumber, findMaxLineNumber(file)),
        1,
      ),
    [filteredFiles],
  );
  const maxLineNumberDigits = String(maxVisibleLineNumber).length;
  const codeViewportWidth = useMemo(
    () =>
      resolveCodeViewportWidth(
        resolvedLayout,
        diffContentWidth,
        maxLineNumberDigits,
        showLineNumbers,
      ),
    [diffContentWidth, maxLineNumberDigits, resolvedLayout, showLineNumbers],
  );
  const isResizingSidebar = resizeDragOriginX !== null && resizeStartWidth !== null;
  const dividerHitLeft = Math.max(
    1,
    1 + clampedSidebarWidth - Math.floor((DIVIDER_HIT_WIDTH - DIVIDER_WIDTH) / 2),
  );

  useEffect(() => {
    if (!renderSidebar) {
      setResizeDragOriginX(null);
      setResizeStartWidth(null);
      return;
    }

    setSidebarWidth((current) => clamp(current, SIDEBAR_MIN_WIDTH, maxSidebarWidth));
  }, [maxSidebarWidth, renderSidebar]);

  /** Show a transient status-line message that auto-clears after a short delay. */
  const flashStatus = useCallback((text: string, durationMs = 2000) => {
    if (transientStatusTimeoutRef.current) {
      clearTimeout(transientStatusTimeoutRef.current);
    }

    setTransientStatus(text);
    transientStatusTimeoutRef.current = setTimeout(() => {
      setTransientStatus(null);
      transientStatusTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (transientStatusTimeoutRef.current) {
        clearTimeout(transientStatusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectionAutoCopy) {
      return;
    }

    const handleSelection = (selection: { getSelectedText?: () => string } | null) => {
      // Skip the copy when a modal or filter input owns the keyboard — the user
      // is typing into a prompt, not selecting code to share.
      if (commentEditorTarget || confirmPrompt || focusArea === "filter") {
        return;
      }

      const text = selection?.getSelectedText?.().trim();
      if (!text) {
        return;
      }

      void copyToClipboard(text).then((copied) => {
        // Surface both success and failure so the user can tell whether the
        // OS helper (pbcopy / wl-copy / xclip) actually accepted the
        // selection. On macOS in particular a silent failure used to look
        // like "select-to-copy isn't working at all".
        flashStatus(copied ? "copied to clipboard" : "clipboard copy failed");
      });
    };

    const unknownRenderer = renderer as unknown as {
      on?: (event: string, handler: (selection: unknown) => void) => void;
      off?: (event: string, handler: (selection: unknown) => void) => void;
    };
    unknownRenderer.on?.("selection", handleSelection as (selection: unknown) => void);
    return () => {
      unknownRenderer.off?.("selection", handleSelection as (selection: unknown) => void);
    };
  }, [commentEditorTarget, confirmPrompt, flashStatus, focusArea, renderer, selectionAutoCopy]);

  useEffect(() => {
    // Force an intermediate redraw when app geometry or row-wrapping changes so pane relayout
    // feels immediate after toggling split/stack or line wrapping.
    renderer.intermediateRender();
  }, [renderer, renderSidebar, resolvedLayout, terminal.height, terminal.width, wrapLines]);

  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    sidebarScrollRef.current?.scrollChildIntoView(fileRowId(selectedFile.id));
  }, [selectedFile]);

  /** Scroll the main review pane by line steps, viewport fractions, or whole-content jumps. */
  const scrollDiff = (
    delta: number,
    unit: "step" | "viewport" | "content" | "half" = "viewport",
  ) => {
    if (unit === "half") {
      const scrollBox = diffScrollRef.current;
      if (!scrollBox) return;

      // Calculate half the viewport height
      const viewportHeight = scrollBox.viewport?.height ?? 20;
      const scrollAmount = Math.floor(viewportHeight / 2);

      // Use scrollTo with current position + delta * amount
      const currentScroll = scrollBox.scrollTop;
      scrollBox.scrollTo(currentScroll + delta * scrollAmount);
      return;
    }
    diffScrollRef.current?.scrollBy(delta, unit);
  };

  const maxCodeHorizontalOffset = useMemo(
    () =>
      Math.max(
        0,
        filteredFiles.reduce(
          (maxWidth, file) => Math.max(maxWidth, maxFileCodeLineWidth(file)),
          0,
        ) - codeViewportWidth,
      ),
    [codeViewportWidth, filteredFiles],
  );

  useEffect(() => {
    setCodeHorizontalOffset((current) => clamp(current, 0, maxCodeHorizontalOffset));
  }, [maxCodeHorizontalOffset]);

  /** Shift the visible code columns horizontally without moving gutters or headers. */
  const scrollCodeHorizontally = useCallback(
    (delta: number) => {
      if (wrapLines || delta === 0 || maxCodeHorizontalOffset <= 0) {
        return;
      }

      setCodeHorizontalOffset((current) => clamp(current + delta, 0, maxCodeHorizontalOffset));
    },
    [maxCodeHorizontalOffset, wrapLines],
  );

  /** Preserve the current review position before changing the active diff layout. */
  const selectLayoutMode = useCallback((mode: LayoutMode) => {
    layoutToggleScrollTopRef.current = diffScrollRef.current?.scrollTop ?? 0;
    setLayoutToggleRequestId((current) => current + 1);
    setLayoutMode(mode);
  }, []);

  const toggleComments = () => {
    setShowComments((current) => !current);
  };

  /** Toggle line-number gutters without changing the diff content itself. */
  const toggleLineNumbers = () => {
    setShowLineNumbers((current) => !current);
  };

  /** Toggle whether diff code rows wrap instead of truncating to one terminal row. */
  const toggleLineWrap = () => {
    // Capture the pre-toggle viewport position synchronously so DiffPane can restore the same
    // top-most source row after wrapped row heights change.
    wrapToggleScrollTopRef.current = diffScrollRef.current?.scrollTop ?? 0;
    setCodeHorizontalOffset(0);
    setWrapLines((current) => !current);
  };

  /** Toggle the sidebar, forcing it open on narrower layouts when the app can still fit both panes. */
  const toggleSidebar = () => {
    if (sidebarVisible && (responsiveLayout.showSidebar || forceSidebarOpen)) {
      setSidebarVisible(false);
      setForceSidebarOpen(false);
      return;
    }

    if (sidebarVisible && !responsiveLayout.showSidebar) {
      if (canForceShowSidebar) {
        setForceSidebarOpen(true);
      }
      return;
    }

    setSidebarVisible(true);
    setForceSidebarOpen(!responsiveLayout.showSidebar && canForceShowSidebar);
  };

  /** Toggle visibility of hunk metadata rows without changing the actual diff lines. */
  const toggleHunkHeaders = () => {
    setShowHunkHeaders((current) => !current);
  };

  /** Jump to an annotated hunk without changing the global note visibility toggle. */
  const openAgentNotesAtHunk = useCallback(
    (fileId: string, hunkIndex: number) => {
      review.selectHunk(fileId, hunkIndex);
    },
    [review.selectHunk],
  );

  const canRefreshCurrentInput = canReloadInput(bootstrap.input);
  const watchEnabled = Boolean(bootstrap.input.options.watch && canRefreshCurrentInput);

  /** Rebuild the current diff source while preserving the active app view options. */
  const refreshCurrentInput = useCallback(async () => {
    if (!canRefreshCurrentInput) {
      return;
    }

    const nextInput = withCurrentViewOptions(bootstrap.input, {
      layoutMode,
      themeId,
      showComments,
      showHunkHeaders,
      showLineNumbers,
      wrapLines,
    });

    await onReloadSession(nextInput, {
      resetApp: false,
      sourcePath:
        bootstrap.input.kind === "vcs" ||
        bootstrap.input.kind === "show" ||
        bootstrap.input.kind === "stash-show"
          ? bootstrap.changeset.sourceLabel
          : undefined,
    });
  }, [
    bootstrap.changeset.sourceLabel,
    bootstrap.input,
    canRefreshCurrentInput,
    layoutMode,
    onReloadSession,
    showComments,
    showHunkHeaders,
    showLineNumbers,
    themeId,
    wrapLines,
  ]);

  const triggerRefreshCurrentInput = useCallback(() => {
    void refreshCurrentInput().catch((error) => {
      console.error("Failed to reload the current diff.", error);
    });
  }, [refreshCurrentInput]);

  /** Resolve the active hunk's repo-root, file path, and post-image range. */
  const focusedHunkTarget = useCallback(() => {
    const selected = review.selectedFile;
    const hunk = review.selectedHunk;
    if (!selected || !hunk || !repoRoot) {
      return null;
    }

    const range = hunkLineRange(hunk).newRange;
    return { repoRoot, filePath: selected.path, range };
  }, [repoRoot, review.selectedFile, review.selectedHunk]);

  /** Apply one mutation to the comments anchored on the focused hunk. */
  const mutateFocusedHunkComments = useCallback(
    (reduce: (file: CommentsFile, matching: PersistedComment[]) => CommentsFile | null) => {
      const target = focusedHunkTarget();
      if (!target) {
        return;
      }

      try {
        mutateCommentsFile(target.repoRoot, (current) => {
          const matching = commentsForHunkRange(current.comments, target.filePath, target.range);
          const next = matching.length === 0 ? current : reduce(current, matching);
          return next ?? current;
        });
      } catch (error) {
        console.error("Failed to mutate dunk comments.", error);
        return;
      }

      triggerRefreshCurrentInput();
    },
    [focusedHunkTarget, triggerRefreshCurrentInput],
  );

  const driftedComments = bootstrap.driftedComments ?? [];

  // Keep the drift selection valid as the bootstrap changes underneath us
  // (a watch-mode reload can resolve drifted comments, shrinking the list).
  useEffect(() => {
    if (selectedDriftIndex === null) {
      return;
    }
    if (driftedComments.length === 0) {
      setSelectedDriftIndex(null);
      return;
    }
    if (selectedDriftIndex >= driftedComments.length) {
      setSelectedDriftIndex(driftedComments.length - 1);
    }
  }, [driftedComments.length, selectedDriftIndex]);

  const deleteFocusedComment = useCallback(() => {
    // Drift focus takes precedence: when J/K has cycled into the drifted
    // banner, `d` removes that specific drifted comment by id rather than
    // the oldest comment on a real hunk.
    if (selectedDriftIndex !== null && repoRoot) {
      const target = driftedComments[selectedDriftIndex];
      if (!target) {
        return;
      }
      try {
        mutateCommentsFile(repoRoot, (current) => withRemovedComment(current, target.id));
      } catch (error) {
        console.error("Failed to delete drifted comment.", error);
        return;
      }
      // Clamp the selection to the remaining drifted list so the focus stays
      // in the banner while there are still entries to address.
      const nextLength = driftedComments.length - 1;
      setSelectedDriftIndex(nextLength > 0 ? Math.min(selectedDriftIndex, nextLength - 1) : null);
      triggerRefreshCurrentInput();
      return;
    }

    mutateFocusedHunkComments((current, matching) => {
      const oldest = matching.reduce((a, b) => (a.id < b.id ? a : b));
      return withRemovedComment(current, oldest.id);
    });
  }, [
    driftedComments,
    mutateFocusedHunkComments,
    repoRoot,
    selectedDriftIndex,
    triggerRefreshCurrentInput,
  ]);

  /** Delete every comment whose file appears in the current diff, after a Y/N confirm. */
  const deleteAllVisibleComments = useCallback(() => {
    if (!repoRoot) {
      return;
    }

    const visiblePaths = new Set<string>();
    for (const file of bootstrap.changeset.files) {
      visiblePaths.add(file.path);
      if (file.previousPath) {
        visiblePaths.add(file.previousPath);
      }
    }

    let pendingCount = 0;
    try {
      const current = readCommentsFileFromRepo(repoRoot);
      pendingCount = current.comments.filter((comment) => visiblePaths.has(comment.file)).length;
    } catch {
      pendingCount = 0;
    }

    if (pendingCount === 0) {
      flashStatus("no comments in this diff");
      return;
    }

    setConfirmPrompt({
      title: "Delete all comments",
      message: `Delete all ${pendingCount} comment${pendingCount === 1 ? "" : "s"} in this diff?`,
      onConfirm: () => {
        setConfirmPrompt(null);
        // Rebuild path set at confirm time so a file-watcher reload while the dialog is
        // open does not leave the operation targeting a stale changeset.
        const finalPaths = new Set<string>();
        for (const file of bootstrap.changeset.files) {
          finalPaths.add(file.path);
          if (file.previousPath) {
            finalPaths.add(file.previousPath);
          }
        }

        try {
          mutateCommentsFile(repoRoot, (current) =>
            withRemovedCommentsForFiles(current, finalPaths),
          );
        } catch (error) {
          console.error("Failed to delete comments in the current diff.", error);
          return;
        }

        // Clearing every comment in the current diff also empties the drifted
        // banner — drop the focus so J/K resumes inside the review stream.
        setSelectedDriftIndex(null);
        triggerRefreshCurrentInput();
      },
    });
  }, [bootstrap.changeset.files, flashStatus, repoRoot, triggerRefreshCurrentInput]);

  /** Open the comment-authoring modal for the bottom line of the focused hunk. */
  const openCommentEditor = useCallback(() => {
    const target = focusedHunkTarget();
    if (!target) {
      return;
    }

    const line = target.range[1];
    const anchor = computeAnchorForFile(target.repoRoot, target.filePath, line);
    if (!anchor) {
      // The post-image was unreadable or the line is out of range — skip rather than fail loudly.
      return;
    }

    setCommentDraftBody("");
    setCommentEditorTarget({
      repoRoot: target.repoRoot,
      filePath: target.filePath,
      line,
      range: target.range,
      anchor,
    });
  }, [focusedHunkTarget]);

  const closeCommentEditor = useCallback(() => {
    setCommentEditorTarget(null);
    setCommentDraftBody("");
  }, []);

  /** Open the focused hunk in the user's editor at the bottom of its post-image range. */
  const openInEditor = useCallback(() => {
    const target = focusedHunkTarget();
    if (!target) {
      return;
    }

    const line = target.range[1];
    const plan = resolveEditorLaunch(target.filePath, line);
    if (!plan) {
      flashStatus("set $EDITOR or $VISUAL to use e");
      return;
    }

    void runEditorLaunch(plan, { cwd: target.repoRoot })
      .then(() => {
        // Detached GUI editors return immediately — chaining a reload then would
        // race the user's typing. Watch mode picks those changes up via fs.watch.
        if (plan.needsTty) {
          triggerRefreshCurrentInput();
        }
      })
      .catch((error) => {
        // Common macOS failure: $EDITOR=zed/cursor/code but the CLI helper is
        // not on PATH (the GUI app installs without a shell shim). Surface a
        // user-facing hint instead of dropping the error into the void.
        const message = error instanceof Error ? error.message : String(error);
        const programName = plan.command[0] ?? "editor";
        flashStatus(`could not launch ${programName}: ${message}`, 4000);
      });
  }, [flashStatus, focusedHunkTarget, triggerRefreshCurrentInput]);

  /** Persist the entered body and reload so the new comment shows up inline. */
  const saveComment = useCallback(
    (body: string) => {
      if (!commentEditorTarget) {
        return;
      }

      const { repoRoot, filePath, line, range, anchor } = commentEditorTarget;
      try {
        mutateCommentsFile(repoRoot, (current) => {
          return withAddedComment(current, {
            file: filePath,
            line,
            range,
            anchor,
            body,
          }).file;
        });
      } catch (error) {
        console.error("Failed to save comment.", error);
        setCommentEditorTarget(null);
        setCommentDraftBody("");
        return;
      }

      setCommentEditorTarget(null);
      setCommentDraftBody("");
      triggerRefreshCurrentInput();
    },
    [commentEditorTarget, triggerRefreshCurrentInput],
  );

  // Hold the current refresher in a ref so view-only state changes (theme,
  // layout, comment toggle, …) don't tear down and re-arm the watch poll. A
  // restart resets `lastSignature`, which would silently swallow any source
  // change that landed during the toggle.
  const refreshCurrentInputRef = useRef(refreshCurrentInput);
  useEffect(() => {
    refreshCurrentInputRef.current = refreshCurrentInput;
  }, [refreshCurrentInput]);

  // Mirror "is the comment modal open" into a ref so the watch poll can read
  // it without re-arming. While set, reload-fires are coalesced into a single
  // pending flush that runs when the modal closes.
  const commentAuthoringRef = useRef(false);
  const pendingPostAuthoringReloadRef = useRef(false);
  useEffect(() => {
    const wasAuthoring = commentAuthoringRef.current;
    const isAuthoring = commentEditorTarget !== null;
    commentAuthoringRef.current = isAuthoring;
    if (wasAuthoring && !isAuthoring && pendingPostAuthoringReloadRef.current) {
      pendingPostAuthoringReloadRef.current = false;
      void refreshCurrentInputRef.current().catch((error) => {
        console.error("Failed to flush post-authoring reload.", error);
      });
    }
  }, [commentEditorTarget]);

  useEffect(() => {
    if (!watchEnabled) {
      return;
    }

    let cancelled = false;
    let polling = false;
    let refreshing = false;
    let lastSignature: string;

    try {
      lastSignature = computeWatchSignature(bootstrap.input);
    } catch (error) {
      console.error("Failed to initialize watch mode.", error);
      return;
    }

    const pollForChanges = () => {
      if (cancelled || polling || refreshing) {
        return;
      }

      polling = true;

      try {
        const nextSignature = computeWatchSignature(bootstrap.input);
        if (nextSignature !== lastSignature) {
          lastSignature = nextSignature;
          // Comment authoring is foreground work — a half-second of stale
          // diff is preferable to dropping the in-flight body when the
          // agent (or anything else) edits the working tree mid-typing.
          // The signature gets updated either way so the poller doesn't
          // loop on the same change; the next save/cancel flushes one
          // refresh to bring the diff back in sync.
          if (commentAuthoringRef.current) {
            pendingPostAuthoringReloadRef.current = true;
          } else {
            refreshing = true;
            void refreshCurrentInputRef
              .current()
              .catch((error) => {
                console.error("Failed to auto-reload the current diff.", error);
              })
              .finally(() => {
                refreshing = false;
              });
          }
        }
      } catch (error) {
        console.error("Failed to poll watch mode input.", error);
      } finally {
        polling = false;
      }
    };

    const interval = setInterval(pollForChanges, 250);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bootstrap.input, watchEnabled]);

  /** Leave the app through the shared shutdown path. */
  const requestQuit = useCallback(() => {
    onQuit();
  }, [onQuit]);

  /** Close the modal keyboard help overlay. */
  const closeHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  /** Toggle the modal keyboard help overlay. */
  const toggleHelp = useCallback(() => {
    setShowHelp((current) => !current);
  }, []);

  /** Focus the file list/sidebar navigation area. */
  const focusFiles = useCallback(() => {
    setFocusArea("files");
  }, []);

  /** Focus the file filter input in the status bar. */
  const focusFilter = useCallback(() => {
    setFocusArea("filter");
  }, []);

  /** Toggle keyboard focus between the file list and the file filter. */
  const toggleFocusArea = useCallback(() => {
    setFocusArea((current) => (current === "files" ? "filter" : "files"));
  }, []);

  /** Cycle through the available built-in themes. */
  const cycleTheme = useCallback(() => {
    const currentIndex = THEMES.findIndex((theme) => theme.id === activeTheme.id);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setThemeId(THEMES[nextIndex]!.id);
  }, [activeTheme.id]);

  useAppKeyboardShortcuts({
    canRefreshCurrentInput,
    closeHelp,
    commentEditorActive: Boolean(commentEditorTarget),
    confirmActive: Boolean(confirmPrompt),
    cycleTheme,
    deleteAllVisibleComments,
    deleteFocusedComment,
    focusArea,
    focusFilter,
    moveToAnnotatedHunk,
    moveToHunk: moveToHunkWithDrift,
    openCommentEditor,
    openInEditor,
    pagerMode,
    requestQuit,
    scrollCodeHorizontally,
    scrollDiff,
    selectLayoutMode,
    showHelp,
    toggleComments,
    toggleFocusArea,
    toggleHelp,
    toggleHunkHeaders,
    toggleLineNumbers,
    toggleLineWrap,
    toggleSidebar,
    triggerRefreshCurrentInput,
  });

  /** Start a mouse drag resize for the optional sidebar. */
  const beginSidebarResize = (event: TuiMouseEvent) => {
    if (event.button !== MouseButton.LEFT) {
      return;
    }

    setResizeDragOriginX(event.x);
    setResizeStartWidth(clampedSidebarWidth);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Update the sidebar width while a drag resize is active. */
  const updateSidebarResize = (event: TuiMouseEvent) => {
    if (!isResizingSidebar || resizeDragOriginX === null || resizeStartWidth === null) {
      return;
    }

    setSidebarWidth(
      resizeSidebarWidth(
        resizeStartWidth,
        resizeDragOriginX,
        event.x,
        SIDEBAR_MIN_WIDTH,
        maxSidebarWidth,
      ),
    );
    event.preventDefault();
    event.stopPropagation();
  };

  /** End the current sidebar resize interaction. */
  const endSidebarResize = (event?: TuiMouseEvent) => {
    if (!isResizingSidebar) {
      return;
    }

    setResizeDragOriginX(null);
    setResizeStartWidth(null);
    event?.preventDefault();
    event?.stopPropagation();
  };

  const sidebarTextWidth = Math.max(8, clampedSidebarWidth - 2);
  const diffHeaderStatsWidth = Math.min(24, Math.max(16, Math.floor(diffContentWidth / 3)));
  const diffHeaderLabelWidth = Math.max(8, diffContentWidth - diffHeaderStatsWidth - 1);
  const diffSeparatorWidth = Math.max(4, diffContentWidth - 2);

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: activeTheme.background,
      }}
    >
      {!pagerMode && bootstrap.driftedComments && bootstrap.driftedComments.length > 0 ? (
        <DriftedCommentsBanner
          drifted={bootstrap.driftedComments}
          selectedIndex={selectedDriftIndex}
          terminalWidth={terminal.width}
          theme={activeTheme}
        />
      ) : null}

      <box
        style={{
          flexGrow: 1,
          flexDirection: "row",
          gap: 0,
          paddingLeft: bodyPadding / 2,
          paddingRight: bodyPadding / 2,
          paddingTop: 0,
          paddingBottom: 0,
          position: "relative",
        }}
        onMouseDrag={updateSidebarResize}
        onMouseDragEnd={endSidebarResize}
        onMouseUp={(event) => {
          endSidebarResize(event);
        }}
      >
        {renderSidebar ? (
          <>
            <SidebarPane
              entries={review.sidebarEntries}
              scrollRef={sidebarScrollRef}
              selectedFileId={selectedFile?.id}
              textWidth={sidebarTextWidth}
              theme={activeTheme}
              width={clampedSidebarWidth}
              onSelectFile={(fileId) => {
                focusFiles();
                jumpToFile(fileId, 0, { alignFileHeaderTop: true });
              }}
            />

            <PaneDivider
              dividerHitLeft={dividerHitLeft}
              dividerHitWidth={DIVIDER_HIT_WIDTH}
              isResizing={isResizingSidebar}
              theme={activeTheme}
              onMouseDown={beginSidebarResize}
              onMouseDrag={updateSidebarResize}
              onMouseDragEnd={endSidebarResize}
              onMouseUp={endSidebarResize}
            />
          </>
        ) : null}

        <DiffPane
          codeHorizontalOffset={codeHorizontalOffset}
          diffContentWidth={diffContentWidth}
          files={filteredFiles}
          pagerMode={pagerMode}
          headerLabelWidth={diffHeaderLabelWidth}
          headerStatsWidth={diffHeaderStatsWidth}
          layout={resolvedLayout}
          scrollRef={diffScrollRef}
          selectedFileId={selectedFile?.id}
          // Mute the in-pane hunk-selected rail when drift focus owns
          // navigation so the user only sees one selection at a time.
          selectedHunkIndex={selectedDriftIndex !== null ? -1 : selectedHunkIndex}
          scrollToNote={review.scrollToNote}
          separatorWidth={diffSeparatorWidth}
          showComments={showComments}
          showLineNumbers={showLineNumbers}
          showHunkHeaders={showHunkHeaders}
          wrapLines={wrapLines}
          wrapToggleScrollTop={wrapToggleScrollTopRef.current}
          layoutToggleScrollTop={layoutToggleScrollTopRef.current}
          layoutToggleRequestId={layoutToggleRequestId}
          selectedFileTopAlignRequestId={review.selectedFileTopAlignRequestId}
          selectedHunkRevealRequestId={review.selectedHunkRevealRequestId}
          theme={activeTheme}
          width={diffPaneWidth}
          onOpenAgentNotesAtHunk={openAgentNotesAtHunk}
          onScrollCodeHorizontally={(delta) => {
            scrollCodeHorizontally(delta * FAST_CODE_HORIZONTAL_SCROLL_COLUMNS);
          }}
          onSelectFile={jumpToFile}
          onSelectHunk={(fileId, hunkIndex) =>
            review.selectHunk(fileId, hunkIndex, { preserveViewport: true })
          }
        />
      </box>

      {!pagerMode ? (
        <StatusBar
          filter={review.filter}
          filterFocused={focusArea === "filter"}
          noticeText={transientStatus ?? undefined}
          terminalWidth={terminal.width}
          theme={activeTheme}
          onFilterInput={review.setFilter}
          onFilterSubmit={focusFiles}
        />
      ) : null}

      {!pagerMode && commentEditorTarget ? (
        <Suspense fallback={null}>
          <LazyCommentEditor
            filePath={commentEditorTarget.filePath}
            line={commentEditorTarget.line}
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            value={commentDraftBody}
            onChange={setCommentDraftBody}
            onCancel={closeCommentEditor}
            onSubmit={saveComment}
          />
        </Suspense>
      ) : null}

      {!pagerMode && confirmPrompt ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            message={confirmPrompt.message}
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            title={confirmPrompt.title}
            onCancel={() => setConfirmPrompt(null)}
            onConfirm={confirmPrompt.onConfirm}
          />
        </Suspense>
      ) : null}

      {!pagerMode && showHelp ? (
        <Suspense fallback={null}>
          <LazyHelpDialog
            canRefresh={canRefreshCurrentInput}
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            onClose={closeHelp}
          />
        </Suspense>
      ) : null}
    </box>
  );
}
