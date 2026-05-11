import type { Annotation, LayoutMode } from "../../../core/types";
import { wrapText } from "../../lib/agentPopover";
import { padText } from "../../lib/text";
import type { AppTheme } from "../../themes";

/**
 * Render an inline review comment as a left-accented block beneath the hunk.
 *
 * The card has no surrounding box: a single colored bar in the gutter signals
 * "this is a comment", the title sits flush with that bar, and the body wraps
 * underneath. Comments are always hunk-anchored (one card per hunk bottom),
 * so per-side docking and guide rails were dropped.
 */

function inlineNoteTitle(noteIndex: number, noteCount: number) {
  return noteCount > 1 ? `Comment ${noteIndex + 1}/${noteCount}` : "Comment";
}

const ACCENT_BAR_WIDTH = 1;
const GUTTER_PADDING = 1;
const LEFT_INDENT = 2;

interface InlineNoteLine {
  kind: "summary" | "rationale";
  text: string;
}

/** Compute the body width and wrapped lines for the card body. */
function buildBodyLines(annotation: Annotation, width: number) {
  const bodyWidth = Math.max(1, width - LEFT_INDENT - ACCENT_BAR_WIDTH - GUTTER_PADDING);
  const lines: InlineNoteLine[] = [
    ...wrapText(annotation.summary ?? "", bodyWidth).map(
      (text) => ({ kind: "summary", text }) as const,
    ),
    ...(annotation.rationale
      ? wrapText(annotation.rationale, bodyWidth).map(
          (text) => ({ kind: "rationale", text }) as const,
        )
      : []),
  ];
  return { bodyWidth, lines };
}

export function measureAgentInlineNoteHeight({
  annotation,
  width,
}: {
  annotation: Annotation;
  /** Kept for compatibility; the new card no longer docks per-side. */
  anchorSide?: "old" | "new";
  /** Kept for compatibility; the layout no longer affects card height. */
  layout?: Exclude<LayoutMode, "auto">;
  width: number;
}) {
  const { lines } = buildBodyLines(annotation, width);
  // Title row + body lines + one trailing blank for breathing room.
  return 1 + lines.length + 1;
}

/** Render the note card itself, anchored at the bottom of the hunk it annotates. */
export function AgentInlineNote({
  annotation,
  noteCount = 1,
  noteIndex = 0,
  onClose,
  theme,
  width,
}: {
  annotation: Annotation;
  /** Unused but kept so existing callers don't have to thread layout state. */
  anchorSide?: "old" | "new";
  layout?: Exclude<LayoutMode, "auto">;
  noteCount?: number;
  noteIndex?: number;
  onClose?: () => void;
  theme: AppTheme;
  width: number;
}) {
  const { bodyWidth, lines } = buildBodyLines(annotation, width);
  const titleText = inlineNoteTitle(noteIndex, noteCount);
  const closeText = onClose ? "[x]" : "";
  const titleWidth = Math.max(1, bodyWidth - (closeText ? closeText.length + 1 : 0));

  return (
    <box style={{ width: "100%", flexDirection: "column", backgroundColor: theme.panel }}>
      <NoteRow theme={theme} width={width}>
        <box style={{ width: titleWidth, height: 1, backgroundColor: theme.panel }}>
          <text fg={theme.accent} bg={theme.panel}>
            {padText(titleText, titleWidth)}
          </text>
        </box>
        {closeText ? (
          <box
            onMouseUp={onClose}
            style={{ width: closeText.length + 1, height: 1, backgroundColor: theme.panel }}
          >
            <text fg={theme.muted} bg={theme.panel}>{` ${closeText}`}</text>
          </box>
        ) : null}
      </NoteRow>

      {lines.map((line, index) => (
        <NoteRow key={`${line.kind}:${index}`} theme={theme} width={width}>
          <box style={{ width: bodyWidth, height: 1, backgroundColor: theme.panel }}>
            <text fg={line.kind === "summary" ? theme.text : theme.muted} bg={theme.panel}>
              {padText(line.text, bodyWidth)}
            </text>
          </box>
        </NoteRow>
      ))}

      <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
        <text>{" ".repeat(Math.max(0, width))}</text>
      </box>
    </box>
  );
}

/** One row of the card: left indent + colored accent bar + content. */
function NoteRow({
  children,
  theme,
  width: _width,
}: {
  children: React.ReactNode;
  theme: AppTheme;
  width: number;
}) {
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: theme.panel }}>
      <box style={{ width: LEFT_INDENT, height: 1, backgroundColor: theme.panel }}>
        <text>{" ".repeat(LEFT_INDENT)}</text>
      </box>
      <box style={{ width: ACCENT_BAR_WIDTH, height: 1, backgroundColor: theme.panel }}>
        <text fg={theme.accent} bg={theme.panel}>
          ▎
        </text>
      </box>
      <box style={{ width: GUTTER_PADDING, height: 1, backgroundColor: theme.panel }}>
        <text>{" ".repeat(GUTTER_PADDING)}</text>
      </box>
      {children}
    </box>
  );
}

/** Trailing cap kept as a no-op so callers don't need to be reworked. */
export function AgentInlineNoteGuideCap({
  theme,
  width,
}: {
  side?: "old" | "new";
  theme: AppTheme;
  width: number;
}) {
  return (
    <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
      <text>{" ".repeat(Math.max(0, width))}</text>
    </box>
  );
}
