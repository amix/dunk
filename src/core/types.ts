import type { FileDiffMetadata } from "@pierre/diffs";

export type LayoutMode = "auto" | "split" | "stack";
export type VcsMode = "git" | "jj";

/** One inline annotation rendered alongside a diff hunk. Carries a user comment. */
export interface Annotation {
  id?: string;
  oldRange?: [number, number];
  newRange?: [number, number];
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
  vcs?: VcsMode;
  theme?: string;
  pager?: boolean;
  watch?: boolean;
  excludeUntracked?: boolean;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  hunkHeaders?: boolean;
  comments?: boolean;
  selectionAutoCopy?: boolean;
}

export interface PersistedViewPreferences {
  mode: LayoutMode;
  theme?: string;
  showLineNumbers: boolean;
  wrapLines: boolean;
  showHunkHeaders: boolean;
  showComments: boolean;
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
  initialShowComments?: boolean;
  initialSelectionAutoCopy?: boolean;
  /** User comments whose recorded anchor no longer matches the current diff. */
  driftedComments?: DriftedCommentSummary[];
}

export type DriftReason = "missing-file" | "out-of-range" | "anchor-mismatch";

/** Snapshot of a drifted user comment, surfaced to the UI for top-of-diff rendering. */
export interface DriftedCommentSummary {
  id: number;
  file: string;
  line: number;
  body: string;
  reason: DriftReason;
}
