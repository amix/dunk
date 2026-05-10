import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import type { DriftedCommentSummary } from "../../../core/types";

const DRIFT_REASON_LABEL: Record<DriftedCommentSummary["reason"], string> = {
  "missing-file": "missing",
  "out-of-range": "out-of-range",
  "anchor-mismatch": "drifted",
};

/**
 * Pinned banner at the top of the diff view that surfaces user comments whose
 * recorded anchor no longer matches the current diff. Rendered with a darker
 * background so it visually separates from the live review stream.
 */
export function DriftedCommentsBanner({
  drifted,
  terminalWidth,
  theme,
}: {
  drifted: DriftedCommentSummary[];
  terminalWidth: number;
  theme: AppTheme;
}) {
  if (drifted.length === 0) {
    return null;
  }

  const visible = drifted.slice(0, 3);
  const hidden = drifted.length - visible.length;
  const innerWidth = Math.max(8, terminalWidth - 4);

  return (
    <box
      style={{
        flexDirection: "column",
        backgroundColor: theme.panelAlt,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      }}
    >
      <text fg={theme.badgeNeutral}>
        {fitText(
          `${drifted.length} drifted comment${drifted.length === 1 ? "" : "s"} · press D on a hunk to dismiss`,
          innerWidth,
        )}
      </text>
      {visible.map((comment) => (
        <text key={comment.id} fg={theme.muted}>
          {fitText(
            `[${DRIFT_REASON_LABEL[comment.reason]}] ${comment.file}:${comment.line} · ${comment.body}`,
            innerWidth,
          )}
        </text>
      ))}
      {hidden > 0 ? (
        <text fg={theme.muted}>{fitText(`+${hidden} more`, innerWidth)}</text>
      ) : null}
    </box>
  );
}
