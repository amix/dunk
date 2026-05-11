/**
 * Compute a transient identity fingerprint for one diff hunk.
 *
 * Used by the comment authoring flow to detect when the diff has churned
 * out from under a modal-open snapshot. If the hunk the user pressed `a`
 * on still hashes to the same fingerprint at submit time, the comment
 * was authored against the same content and is safe to persist; if the
 * fingerprint changed, the original hunk likely split, merged, or moved
 * and we should refuse rather than silently anchor against the wrong code.
 *
 * The fingerprint is in-memory only — it never reaches `.dunk/comments.json`.
 */
import { createHash } from "node:crypto";
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

/** Hash the actual addition + deletion text of a hunk, framed by its line numbers. */
export function hunkFingerprint(metadata: FileDiffMetadata, hunk: Hunk): string {
  const additions = metadata.additionLines.slice(
    hunk.additionLineIndex,
    hunk.additionLineIndex + hunk.additionLines,
  );
  const deletions = metadata.deletionLines.slice(
    hunk.deletionLineIndex,
    hunk.deletionLineIndex + hunk.deletionLines,
  );

  // Frame each line with `+` / `-` so two hunks with the same content but
  // different add/delete shape — e.g. `+foo` vs `-foo` — never collide.
  const framed = [
    `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`,
    ...deletions.map((line) => `-${line}`),
    ...additions.map((line) => `+${line}`),
  ].join("\n");

  return createHash("sha256").update(framed).digest("hex").slice(0, 16);
}
