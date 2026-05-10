import type { Hunk } from "@pierre/diffs";

/**
 * Compute the inclusive old/new line spans for the visible extent of a hunk.
 *
 * Use the per-side `*Count` from the hunk header (`-X,count` / `+X,count`),
 * which includes both context and changed lines, not the `*Lines` count which
 * is only the `+` / `-` lines.
 */
export function hunkLineRange(hunk: Hunk) {
  const newEnd = Math.max(
    hunk.additionStart,
    hunk.additionStart + Math.max(hunk.additionCount, 1) - 1,
  );
  const oldEnd = Math.max(
    hunk.deletionStart,
    hunk.deletionStart + Math.max(hunk.deletionCount, 1) - 1,
  );

  return {
    oldRange: [hunk.deletionStart, oldEnd] as [number, number],
    newRange: [hunk.additionStart, newEnd] as [number, number],
  };
}
