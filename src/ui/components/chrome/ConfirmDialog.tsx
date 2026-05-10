import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { isEscapeKey } from "../../lib/keyboard";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import { ModalFrame } from "./ModalFrame";

/** Modal Y/N prompt for destructive actions. */
export function ConfirmDialog({
  message,
  terminalHeight,
  terminalWidth,
  theme,
  title = "Confirm",
  onCancel,
  onConfirm,
}: {
  message: string;
  terminalHeight: number;
  terminalWidth: number;
  theme: AppTheme;
  title?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const width = Math.min(64, Math.max(40, terminalWidth - 8));
  const height = Math.min(8, Math.max(7, terminalHeight - 6));
  const innerWidth = Math.max(8, width - 4);

  useKeyboard((key: KeyEvent) => {
    if (isEscapeKey(key) || key.sequence === "n" || key.sequence === "N") {
      onCancel();
      return;
    }

    if (key.sequence === "y" || key.sequence === "Y" || key.name === "return") {
      onConfirm();
    }
  });

  return (
    <ModalFrame
      height={height}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      theme={theme}
      title={title}
      width={width}
      onClose={onCancel}
    >
      <text fg={theme.text}>{fitText(message, innerWidth)}</text>
      <box style={{ width: "100%", height: 1 }} />
      <text fg={theme.muted}>{fitText("y to confirm · n or Esc to cancel", innerWidth)}</text>
    </ModalFrame>
  );
}
