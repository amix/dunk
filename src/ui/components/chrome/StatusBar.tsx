import { isEscapeKey } from "../../lib/keyboard";
import type { AppTheme } from "../../themes";

/** Render the active file filter input or current filter summary. */
export function StatusBar({
  filter,
  filterFocused,
  noticeText,
  terminalWidth,
  theme,
  onFilterInput,
  onFilterSubmit,
}: {
  filter: string;
  filterFocused: boolean;
  noticeText?: string;
  terminalWidth: number;
  theme: AppTheme;
  onFilterInput: (value: string) => void;
  onFilterSubmit: () => void;
}) {
  return (
    <box
      style={{
        height: 1,
        backgroundColor: theme.panelAlt,
        paddingLeft: 1,
        paddingRight: 1,
        alignItems: "center",
        flexDirection: "row",
      }}
    >
      {filterFocused ? (
        <>
          <text fg={theme.badgeNeutral}>filter:</text>
          <box style={{ width: 1, height: 1 }}>
            <text fg={theme.muted}> </text>
          </box>
          <input
            width={Math.max(12, terminalWidth - 11)}
            value={filter}
            placeholder="type to filter files"
            focused={true}
            onInput={onFilterInput}
            onSubmit={onFilterSubmit}
            onKeyDown={(key) => {
              if (!isEscapeKey(key)) {
                return;
              }

              key.preventDefault();
              key.stopPropagation();

              if (filter.length > 0) {
                onFilterInput("");
                return;
              }

              onFilterSubmit();
            }}
          />
        </>
      ) : filter.length > 0 ? (
        <text fg={theme.muted}>{`filter=${filter}`}</text>
      ) : noticeText ? (
        <text fg={theme.muted}>{noticeText}</text>
      ) : (
        <text fg={theme.muted}>Press ? for help</text>
      )}
    </box>
  );
}
