import { fitText, padText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import type { DriftedCommentSummary } from "../../../core/types";

const DRIFT_REASON_LABEL: Record<DriftedCommentSummary["reason"], string> = {
  "missing-file": "missing",
  "out-of-range": "out-of-range",
  "anchor-mismatch": "drifted",
};

/**
 * Pinned banner at the top of the diff view that surfaces user comments whose
 * recorded anchor no longer matches the current diff. J/K cycles selection
 * within the banner; `d` deletes the focused entry. The selected row is
 * highlighted with the active accent so it reads like any other selectable
 * hunk.
 */
export function DriftedCommentsBanner({
  drifted,
  selectedIndex,
  terminalWidth,
  theme,
}: {
  drifted: DriftedCommentSummary[];
  selectedIndex: number | null;
  terminalWidth: number;
  theme: AppTheme;
}) {
  if (drifted.length === 0) {
    return null;
  }

  const innerWidth = Math.max(8, terminalWidth - 4);
  const headerHint =
    selectedIndex === null
      ? "K to focus · D to clear all"
      : `${selectedIndex + 1}/${drifted.length} focused · d to delete · J/K to move`;

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
          `${drifted.length} drifted comment${drifted.length === 1 ? "" : "s"} · ${headerHint}`,
          innerWidth,
        )}
      </text>
      {drifted.map((comment, index) => {
        const focused = index === selectedIndex;
        const fg = focused ? theme.text : theme.muted;
        const bg = focused ? theme.noteTitleBackground : theme.panelAlt;
        const marker = focused ? "▸ " : "  ";
        const body = `${marker}[${DRIFT_REASON_LABEL[comment.reason]}] ${comment.file}:${comment.line} · ${comment.body}`;
        return (
          <text key={comment.id} fg={fg} bg={bg}>
            {padText(fitText(body, innerWidth), innerWidth)}
          </text>
        );
      })}
    </box>
  );
}
