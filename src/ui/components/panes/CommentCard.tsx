import type { Annotation, LayoutMode } from "../../../core/types";
import { wrapText } from "../../lib/agentPopover";
import { padText } from "../../lib/text";
import type { AppTheme } from "../../themes";

/**
 * Render one review comment as a left-accented block. Used inline beneath the
 * hunk for anchored comments and stacked in the top-of-diff drift banner for
 * comments that no longer match the rendered hunks; the visual surface is the
 * same so the user sees one primitive everywhere.
 *
 * The card is body-first: a quiet `#id` (and a "1 of N" tail when the hunk
 * has multiple comments) sits as muted metadata above the prose, so the
 * comment text itself carries the visual weight. The left `▎` bar runs the
 * full height of the card so wrapped prose reads as one object.
 */

/** Parse `dunk-comment:42` style ids back into their numeric handle, if shaped that way. */
function parseCommentId(annotationId: string | undefined): number | null {
  if (!annotationId?.startsWith("dunk-comment:")) {
    return null;
  }
  const parsed = Number.parseInt(annotationId.slice("dunk-comment:".length), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build the muted metadata header for one card: `#id · 1 of N` when a hunk
 * has multiple comments, just `#id` when single, or "" when the annotation
 * has no parseable id (defensive — never observed in practice).
 */
function buildMetadataLabel(
  annotationId: string | undefined,
  commentIndex: number,
  commentCount: number,
) {
  const id = parseCommentId(annotationId);
  if (id === null) {
    return "";
  }
  return commentCount > 1 ? `#${id} · ${commentIndex + 1} of ${commentCount}` : `#${id}`;
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

export function measureCommentCardHeight({
  annotation,
  width,
}: {
  annotation: Annotation;
  /** Kept for compatibility; the card no longer docks per-side. */
  anchorSide?: "old" | "new";
  /** Kept for compatibility; the layout no longer affects card height. */
  layout?: Exclude<LayoutMode, "auto">;
  width: number;
}) {
  const { lines } = buildBodyLines(annotation, width);
  // Title row + body lines + one trailing blank for breathing room.
  return 1 + lines.length + 1;
}

/** Render the card itself, anchored at the bottom of the hunk it annotates. */
export function CommentCard({
  annotation,
  commentCount = 1,
  commentIndex = 0,
  onClose,
  theme,
  width,
}: {
  annotation: Annotation;
  /** Unused but kept so existing callers don't have to thread layout state. */
  anchorSide?: "old" | "new";
  layout?: Exclude<LayoutMode, "auto">;
  commentCount?: number;
  commentIndex?: number;
  onClose?: () => void;
  theme: AppTheme;
  width: number;
}) {
  const { bodyWidth, lines } = buildBodyLines(annotation, width);
  const metadataLabel = buildMetadataLabel(annotation.id, commentIndex, commentCount);
  const closeText = onClose ? "[x]" : "";
  const metadataWidth = Math.max(1, bodyWidth - (closeText ? closeText.length + 1 : 0));

  return (
    <box style={{ width: "100%", flexDirection: "column", backgroundColor: theme.noteBackground }}>
      {/* Metadata row is always rendered so planning geometry can predict the card
          height without knowing whether an id is present. When there is nothing
          to show in the row it stays as a blank `▎` band, giving the card a
          consistent top edge. */}
      <CommentRow theme={theme} width={width}>
        <box style={{ width: metadataWidth, height: 1, backgroundColor: theme.noteBackground }}>
          <text fg={theme.muted} bg={theme.noteBackground}>
            {padText(metadataLabel, metadataWidth)}
          </text>
        </box>
        {closeText ? (
          <box
            onMouseUp={onClose}
            style={{
              width: closeText.length + 1,
              height: 1,
              backgroundColor: theme.noteBackground,
            }}
          >
            <text fg={theme.muted} bg={theme.noteBackground}>{` ${closeText}`}</text>
          </box>
        ) : null}
      </CommentRow>

      {lines.map((line, index) => (
        <CommentRow key={`${line.kind}:${index}`} theme={theme} width={width}>
          <box style={{ width: bodyWidth, height: 1, backgroundColor: theme.noteBackground }}>
            <text
              fg={line.kind === "summary" ? theme.noteTitleText : theme.muted}
              bg={theme.noteBackground}
            >
              {padText(line.text, bodyWidth)}
            </text>
          </box>
        </CommentRow>
      ))}

      {/* Trailing blank uses the diff background, not the card background,
          so consecutive comments on the same hunk read as separate cards
          with a single row of breathing space between them. */}
      <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
        <text>{" ".repeat(Math.max(0, width))}</text>
      </box>
    </box>
  );
}

/** One row of the card: left indent + colored accent bar + content. */
function CommentRow({
  children,
  theme,
  width: _width,
}: {
  children: React.ReactNode;
  theme: AppTheme;
  width: number;
}) {
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: theme.noteBackground,
      }}
    >
      <box style={{ width: LEFT_INDENT, height: 1, backgroundColor: theme.noteBackground }}>
        <text>{" ".repeat(LEFT_INDENT)}</text>
      </box>
      <box style={{ width: ACCENT_BAR_WIDTH, height: 1, backgroundColor: theme.noteBackground }}>
        <text fg={theme.noteBorder} bg={theme.noteBackground}>
          ▎
        </text>
      </box>
      <box style={{ width: GUTTER_PADDING, height: 1, backgroundColor: theme.noteBackground }}>
        <text>{" ".repeat(GUTTER_PADDING)}</text>
      </box>
      {children}
    </box>
  );
}

/** Trailing blank row beneath the card, kept as an export so older planning code can address it by name. */
export function CommentCardSpacer({
  theme,
  width,
}: {
  side?: "old" | "new";
  theme: AppTheme;
  width: number;
}) {
  return (
    <box style={{ width: "100%", height: 1, backgroundColor: theme.noteBackground }}>
      <text>{" ".repeat(Math.max(0, width))}</text>
    </box>
  );
}
