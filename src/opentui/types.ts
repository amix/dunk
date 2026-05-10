import type { FileDiffMetadata } from "@pierre/diffs";
import type { DunkDiffThemeName } from "./themes";

export type DunkDiffLayout = "split" | "stack";

/** One diff file body that the exported OpenTUI component can render. */
export interface DunkDiffFile {
  id: string;
  metadata: FileDiffMetadata;
  language?: string;
  path?: string;
  patch?: string;
}

/** Public props for the reusable OpenTUI diff component. */
export interface DunkDiffViewProps {
  diff?: DunkDiffFile;
  layout?: DunkDiffLayout;
  width: number;
  theme?: DunkDiffThemeName;
  showLineNumbers?: boolean;
  showHunkHeaders?: boolean;
  wrapLines?: boolean;
  horizontalOffset?: number;
  highlight?: boolean;
  scrollable?: boolean;
  selectedHunkIndex?: number;
}
