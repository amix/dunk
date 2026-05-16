import type { FileDiffMetadata } from "@pierre/diffs";

export type LayoutMode = "auto" | "split" | "stack";

/** Inclusive 1-based [start, end] line range used by annotations and persisted comments. */
export type LineRange = [number, number];

/** One inline annotation rendered alongside a diff hunk. Carries a user comment. */
export interface Annotation {
  id?: string;
  oldRange?: LineRange;
  newRange?: LineRange;
  summary?: string;
  rationale?: string;
}

export interface DiffFile {
  id: string;
  path: string;
  previousPath?: string;
  patch: string;
  language?: string;
  stats: {
    additions: number;
    deletions: number;
  };
  metadata: FileDiffMetadata;
  annotations: Annotation[];
  isUntracked?: boolean;
  isBinary?: boolean;
  isTooLarge?: boolean;
  statsTruncated?: boolean;
}

export interface Changeset {
  id: string;
  sourceLabel: string;
  title: string;
  summary?: string;
  files: DiffFile[];
}

export interface CommonOptions {
  mode?: LayoutMode;
  theme?: string;
  pager?: boolean;
  watch?: boolean;
  excludeUntracked?: boolean;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  hunkHeaders?: boolean;
  selectionAutoCopy?: boolean;
  /** Default base ref/revset for `dunk diff --branch` when no explicit base is passed. */
  branchReviewBase?: string;
}

/** Branch-review request attached to a `dunk diff` invocation. */
export interface BranchReviewRequest {
  /** Base ref or revset the user typed on the CLI, if any. */
  explicitBase?: string;
}

export interface PersistedViewPreferences {
  mode: LayoutMode;
  theme?: string;
  showLineNumbers: boolean;
  wrapLines: boolean;
  showHunkHeaders: boolean;
  selectionAutoCopy: boolean;
}

export interface HelpCommandInput {
  kind: "help";
  text: string;
}

export interface PagerCommandInput {
  kind: "pager";
  options: CommonOptions;
}

export interface VcsCommandInput {
  kind: "vcs";
  range?: string;
  staged: boolean;
  pathspecs?: string[];
  options: CommonOptions;
  /** Present when the user invoked `dunk diff --branch[=base]`. */
  branchReview?: BranchReviewRequest;
}

export interface ShowCommandInput {
  kind: "show";
  ref?: string;
  pathspecs?: string[];
  options: CommonOptions;
}

export interface StashShowCommandInput {
  kind: "stash-show";
  ref?: string;
  options: CommonOptions;
}

export interface FileCommandInput {
  kind: "diff";
  left: string;
  right: string;
  options: CommonOptions;
}

export interface PatchCommandInput {
  kind: "patch";
  file?: string;
  text?: string;
  options: CommonOptions;
}

export interface DiffToolCommandInput {
  kind: "difftool";
  left: string;
  right: string;
  path?: string;
  options: CommonOptions;
}

export type CliInput =
  | VcsCommandInput
  | ShowCommandInput
  | StashShowCommandInput
  | FileCommandInput
  | PatchCommandInput
  | DiffToolCommandInput;

export type ParsedCliInput = CliInput | HelpCommandInput | PagerCommandInput;

export interface AppBootstrap {
  input: CliInput;
  changeset: Changeset;
  initialMode: LayoutMode;
  initialTheme?: string;
  initialShowLineNumbers?: boolean;
  initialWrapLines?: boolean;
  initialShowHunkHeaders?: boolean;
  initialSelectionAutoCopy?: boolean;
  /** User comments that cannot be rendered in the current diff. */
  driftedComments?: DriftedCommentSummary[];
  /** Persistent status-bar notice (e.g. "branch base: origin/main"). */
  sessionNotice?: string;
}

export type DriftReason = "missing-file" | "out-of-range" | "anchor-mismatch" | "not-in-hunk";

/** Snapshot of a drifted user comment, surfaced to the UI for top-of-diff rendering. */
export interface DriftedCommentSummary {
  id: number;
  file: string;
  line: number;
  body: string;
  reason: DriftReason;
}
