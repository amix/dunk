import type { Hunk } from "@pierre/diffs";

/** Format a unified-diff hunk header exactly as dunk should display it. */
export function formatHunkHeader(hunk: Hunk) {
  // The header carries the per-side `*Count` (context + changed lines), not `*Lines` (changed only).
  const specs =
    hunk.hunkSpecs ??
    `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
  return hunk.hunkContext ? `${specs} ${hunk.hunkContext}` : specs;
}
