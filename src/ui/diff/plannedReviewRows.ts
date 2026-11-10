import type { LayoutMode } from "../../core/types";
import { measureCommentCardHeight } from "../components/panes/CommentCard";
import type { VerticalBounds } from "../lib/diffSpatial";
import type { PlannedReviewRow } from "./reviewRenderPlan";

/** Layout inputs needed to turn one planned review row into concrete terminal height. */
export interface PlannedReviewRowLayoutOptions {
  showHunkHeaders: boolean;
  layout: Exclude<LayoutMode, "auto">;
  width: number;
}

/**
 * Visible bounds for one hunk within a file section body.
 *
 * The row ids let DiffPane upgrade from planned measurements to exact mounted measurements later.
 */
export interface PlannedHunkBounds extends VerticalBounds {
  startRowId: string;
  endRowId: string;
}

/** Measure how many terminal rows one planned review row will occupy once rendered. */
export function plannedReviewRowHeight(
  row: PlannedReviewRow,
  { showHunkHeaders, layout, width }: PlannedReviewRowLayoutOptions,
) {
  if (row.kind === "inline-note") {
    return measureCommentCardHeight({
      annotation: row.annotation,
      layout,
      width,
    });
  }

  if (row.row.type === "hunk-header") {
    return showHunkHeaders ? 1 : 0;
  }

  return 1;
}

/** Check whether a planned row will produce any visible output at all. */
export function plannedReviewRowVisible(
  row: PlannedReviewRow,
  options: PlannedReviewRowLayoutOptions,
) {
  return plannedReviewRowHeight(row, options) > 0;
}
