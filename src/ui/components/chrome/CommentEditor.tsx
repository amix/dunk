import type { KeyEvent } from "@opentui/core";
import { isEscapeKey } from "../../lib/keyboard";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import { ModalFrame } from "./ModalFrame";

/**
 * Modal editor for authoring a single user comment on the focused hunk.
 *
 * The draft body is owned by `App` and threaded in via `value`/`onChange`. If
 * this subtree remounts (OpenTUI focus, render reconciliation), the in-flight
 * text survives because the source of truth lives at the app level.
 */
export function CommentEditor({
  filePath,
  line,
  terminalHeight,
  terminalWidth,
  theme,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  filePath: string;
  line: number;
  terminalHeight: number;
  terminalWidth: number;
  theme: AppTheme;
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const width = Math.min(72, Math.max(40, terminalWidth - 8));
  // Title row + spacer + target row + spacer + input row + ModalFrame chrome
  // (border + title + padding + spacer) = 6 chrome + 3 content rows.
  const height = Math.min(9, Math.max(7, terminalHeight - 6));
  const inputWidth = Math.max(8, width - 4);
  const target = `${filePath}:${line}`;

  return (
    <ModalFrame
      height={height}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      theme={theme}
      title="Add comment"
      width={width}
      onClose={onCancel}
    >
      <text fg={theme.muted}>{fitText(target, inputWidth)}</text>
      <box style={{ width: "100%", height: 1 }} />
      <input
        width={inputWidth}
        value={value}
        placeholder="comment"
        focused={true}
        onInput={onChange}
        onSubmit={() => {
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            onCancel();
            return;
          }

          onSubmit(trimmed);
        }}
        onKeyDown={(key: KeyEvent) => {
          if (!isEscapeKey(key)) {
            return;
          }

          key.preventDefault();
          key.stopPropagation();
          onCancel();
        }}
      />
    </ModalFrame>
  );
}
