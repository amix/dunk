import type { AppBootstrap, DiffFile, VcsCommandInput, LayoutMode } from "../../src/core/types";

export function createTestVcsAppBootstrap({
  changesetId = "changeset:test",
  files,
  vcsOptions = {},
  initialMode = "split",
  initialShowHunkHeaders,
  initialShowLineNumbers,
  initialTheme = "midnight",
  initialWrapLines,
  inputMode = initialMode,
  pager = false,
  sourceLabel = "repo",
  summary,
  title = "repo working tree",
}: {
  changesetId?: string;
  files: DiffFile[];
  vcsOptions?: Partial<VcsCommandInput["options"]>;
  initialMode?: LayoutMode;
  initialShowHunkHeaders?: boolean;
  initialShowLineNumbers?: boolean;
  initialTheme?: string;
  initialWrapLines?: boolean;
  inputMode?: LayoutMode;
  pager?: boolean;
  sourceLabel?: string;
  summary?: string;
  title?: string;
}): AppBootstrap {
  return {
    input: {
      kind: "vcs",
      staged: false,
      options: {
        mode: inputMode,
        pager,
        ...vcsOptions,
      },
    },
    changeset: {
      files,
      id: changesetId,
      sourceLabel,
      summary,
      title,
    },
    initialMode,
    initialShowHunkHeaders,
    initialShowLineNumbers,
    initialTheme,
    initialWrapLines,
  };
}
