import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import type { LayoutMode } from "../../core/types";
import {
  isEscapeKey,
  isHalfPageDownKey,
  isHalfPageUpKey,
  isPageDownKey,
  isPageUpKey,
  isShiftSpacePageUpKey,
  isStepDownKey,
  isStepUpKey,
} from "../lib/keyboard";

type FocusArea = "files" | "filter";
type ScrollUnit = "step" | "viewport" | "content" | "half";

const FAST_CODE_HORIZONTAL_SCROLL_COLUMNS = 8;

export interface UseAppKeyboardShortcutsOptions {
  canRefreshCurrentInput: boolean;
  closeHelp: () => void;
  commentEditorActive: boolean;
  confirmActive: boolean;
  cycleTheme: () => void;
  deleteAllVisibleComments: () => void;
  deleteFocusedComment: () => void;
  focusArea: FocusArea;
  focusFilter: () => void;
  moveToAnnotatedHunk: (delta: number) => void;
  moveToHunk: (delta: number) => void;
  openCommentEditor: () => void;
  openInEditor: () => void;
  pagerMode: boolean;
  requestQuit: () => void;
  scrollCodeHorizontally: (delta: number) => void;
  scrollDiff: (delta: number, unit: ScrollUnit) => void;
  selectLayoutMode: (mode: LayoutMode) => void;
  showHelp: boolean;
  toggleComments: () => void;
  toggleFocusArea: () => void;
  toggleHelp: () => void;
  toggleHunkHeaders: () => void;
  toggleLineNumbers: () => void;
  toggleLineWrap: () => void;
  toggleSidebar: () => void;
  triggerRefreshCurrentInput: () => void;
}

/** Register the app's scoped keyboard handling while keeping mode precedence explicit. */
export function useAppKeyboardShortcuts({
  canRefreshCurrentInput,
  closeHelp,
  commentEditorActive,
  confirmActive,
  cycleTheme,
  deleteAllVisibleComments,
  deleteFocusedComment,
  focusArea,
  focusFilter,
  moveToAnnotatedHunk,
  moveToHunk,
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
}: UseAppKeyboardShortcutsOptions) {
  const focusAreaRef = useRef(focusArea);
  const pagerModeRef = useRef(pagerMode);
  const showHelpRef = useRef(showHelp);
  const commentEditorActiveRef = useRef(commentEditorActive);
  const confirmActiveRef = useRef(confirmActive);

  focusAreaRef.current = focusArea;
  pagerModeRef.current = pagerMode;
  showHelpRef.current = showHelp;
  commentEditorActiveRef.current = commentEditorActive;
  confirmActiveRef.current = confirmActive;

  const handlePagerShortcut = (key: KeyEvent) => {
    if (key.name === "q" || isEscapeKey(key)) {
      requestQuit();
      return;
    }

    if (isPageDownKey(key)) {
      scrollDiff(1, "viewport");
      return;
    }

    if (isPageUpKey(key) || isShiftSpacePageUpKey(key)) {
      scrollDiff(-1, "viewport");
      return;
    }

    if (isHalfPageDownKey(key)) {
      scrollDiff(1, "half");
      return;
    }

    if (isHalfPageUpKey(key)) {
      scrollDiff(-1, "half");
      return;
    }

    if (isStepDownKey(key)) {
      scrollDiff(1, "step");
      return;
    }

    if (isStepUpKey(key)) {
      scrollDiff(-1, "step");
      return;
    }

    if (key.name === "left") {
      scrollCodeHorizontally(key.shift ? -FAST_CODE_HORIZONTAL_SCROLL_COLUMNS : -1);
      return;
    }

    if (key.name === "right") {
      scrollCodeHorizontally(key.shift ? FAST_CODE_HORIZONTAL_SCROLL_COLUMNS : 1);
      return;
    }

    if (key.name === "home") {
      scrollDiff(-1, "content");
      return;
    }

    if (key.name === "end") {
      scrollDiff(1, "content");
      return;
    }

    if (key.name === "w" || key.sequence === "w") {
      toggleLineWrap();
      return;
    }

    if (key.name === "s" || key.sequence === "s") {
      toggleSidebar();
    }
  };

  const handleHelpShortcut = (key: KeyEvent) => {
    if (!showHelpRef.current || !isEscapeKey(key)) {
      return false;
    }

    closeHelp();
    return true;
  };

  const handleFilterShortcut = (key: KeyEvent) => {
    if (focusAreaRef.current !== "filter") {
      return false;
    }

    if (key.name === "tab") {
      toggleFocusArea();
      return true;
    }

    // Let the focused input own filter editing and escape handling.
    return true;
  };

  const handleAppShortcut = (key: KeyEvent) => {
    if (key.name === "q") {
      requestQuit();
      return;
    }

    if (key.name === "?" || key.sequence === "?") {
      toggleHelp();
      return;
    }

    if (isEscapeKey(key)) {
      requestQuit();
      return;
    }

    if (key.name === "tab") {
      toggleFocusArea();
      return;
    }

    if (key.name === "/") {
      focusFilter();
      return;
    }

    if (isPageDownKey(key)) {
      scrollDiff(1, "viewport");
      return;
    }

    if (isPageUpKey(key) || isShiftSpacePageUpKey(key)) {
      scrollDiff(-1, "viewport");
      return;
    }

    if (isHalfPageDownKey(key)) {
      scrollDiff(1, "half");
      return;
    }

    if (isHalfPageUpKey(key)) {
      scrollDiff(-1, "half");
      return;
    }

    if (key.name === "home") {
      scrollDiff(-1, "content");
      return;
    }

    if (key.name === "end") {
      scrollDiff(1, "content");
      return;
    }

    if (isStepUpKey(key)) {
      scrollDiff(-1, "step");
      return;
    }

    if (isStepDownKey(key)) {
      scrollDiff(1, "step");
      return;
    }

    if (key.name === "left") {
      scrollCodeHorizontally(key.shift ? -FAST_CODE_HORIZONTAL_SCROLL_COLUMNS : -1);
      return;
    }

    if (key.name === "right") {
      scrollCodeHorizontally(key.shift ? FAST_CODE_HORIZONTAL_SCROLL_COLUMNS : 1);
      return;
    }

    if (key.name === "1") {
      selectLayoutMode("split");
      return;
    }

    if (key.name === "2") {
      selectLayoutMode("stack");
      return;
    }

    if (key.name === "0") {
      selectLayoutMode("auto");
      return;
    }

    if (key.name === "s") {
      toggleSidebar();
      return;
    }

    if ((key.name === "r" || key.sequence === "r") && canRefreshCurrentInput) {
      triggerRefreshCurrentInput();
      return;
    }

    if (key.name === "t") {
      cycleTheme();
      return;
    }

    if (key.name === "a") {
      openCommentEditor();
      return;
    }

    if (key.sequence === "c") {
      toggleComments();
      return;
    }

    if (key.name === "l" || key.sequence === "l") {
      toggleLineNumbers();
      return;
    }

    if (key.name === "w" || key.sequence === "w") {
      toggleLineWrap();
      return;
    }

    if (key.name === "m" || key.sequence === "m") {
      toggleHunkHeaders();
      return;
    }

    if (key.sequence === "K") {
      moveToHunk(-1);
      return;
    }

    if (key.sequence === "J") {
      moveToHunk(1);
      return;
    }

    if (key.sequence === "D") {
      deleteAllVisibleComments();
      return;
    }

    if (key.sequence === "d") {
      deleteFocusedComment();
      return;
    }

    if (key.sequence === "e") {
      openInEditor();
      return;
    }

    if (key.sequence === "{") {
      moveToAnnotatedHunk(-1);
      return;
    }

    if (key.sequence === "}") {
      moveToAnnotatedHunk(1);
    }
  };

  useKeyboard((key: KeyEvent) => {
    if (commentEditorActiveRef.current || confirmActiveRef.current) {
      // The comment editor and confirm dialog own the keyboard while they are open;
      // don't let `q`, `?`, `s`, etc. fire as global shortcuts mid-prompt.
      return;
    }

    if (pagerModeRef.current) {
      handlePagerShortcut(key);
      return;
    }

    if (handleHelpShortcut(key)) {
      return;
    }

    if (handleFilterShortcut(key)) {
      return;
    }

    handleAppShortcut(key);
  });
}
