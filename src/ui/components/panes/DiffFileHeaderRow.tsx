import type { DiffFile } from "../../../core/types";
import { fileLabelParts } from "../../lib/files";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";

interface DiffFileHeaderRowProps {
  file: DiffFile;
  headerLabelWidth: number;
  headerStatsWidth: number;
  theme: AppTheme;
  onSelect?: () => void;
}

/** Render one file header row in the review stream or sticky overlay. */
export function DiffFileHeaderRow({
  file,
  headerLabelWidth,
  headerStatsWidth,
  theme,
  onSelect,
}: DiffFileHeaderRowProps) {
  const additionsText = `+${file.stats.additions}${file.statsTruncated ? "+" : ""}`;
  const deletionsText = `-${file.stats.deletions}`;
  const { filename, stateLabel } = fileLabelParts(file);

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.accentMuted,
      }}
      onMouseUp={onSelect}
    >
      <box style={{ flexDirection: "row", backgroundColor: theme.accentMuted }}>
        <text fg={theme.text} bg={theme.accentMuted}>
          {fitText(filename, Math.max(1, headerLabelWidth - (stateLabel?.length ?? 0)))}
        </text>
        {stateLabel && (
          <text fg={theme.text} bg={theme.accentMuted}>
            {stateLabel}
          </text>
        )}
      </box>
      <box
        style={{
          width: headerStatsWidth,
          height: 1,
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: theme.accentMuted,
        }}
      >
        <text fg={theme.badgeAdded} bg={theme.accentMuted}>
          {additionsText}
        </text>
        <text fg={theme.text} bg={theme.accentMuted}>
          {" "}
        </text>
        <text fg={theme.badgeRemoved} bg={theme.accentMuted}>
          {deletionsText}
        </text>
      </box>
    </box>
  );
}
