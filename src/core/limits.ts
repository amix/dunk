/**
 * Shared resource caps for file reads. The diff loader and the
 * comment-anchored reader both honor the same byte limit so a single
 * generated 50 MB file can't blow memory through either path.
 */

/** Hard cap on per-file bytes any review-time loader will read in full. */
export const LARGE_FILE_MAX_BYTES = 1_000_000;
