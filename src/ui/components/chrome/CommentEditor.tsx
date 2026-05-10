import type { KeyEvent } from "@opentui/core";
import { useState } from "react";
import { isEscapeKey } from "../../lib/keyboard";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import { ModalFrame } from "./ModalFrame";

/** Modal editor for authoring a single user comment on the focused hunk. */
export function CommentEditor({
  filePath,
  line,
  terminalHeight,
  terminalWidth,
  theme,
  onCancel,
  onSubmit,
}: {
  filePath: string;
  line: number;
  terminalHeight: number;
  terminalWidth: number;
  theme: AppTheme;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");

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
        value={body}
        placeholder="comment"
        focused={true}
        onInput={setBody}
        onSubmit={() => {
          const trimmed = body.trim();
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
