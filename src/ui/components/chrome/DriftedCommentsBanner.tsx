import type { DriftedCommentSummary } from "../../../core/types";
import { wrapText } from "../../lib/agentPopover";
import { fitText, padText } from "../../lib/text";
import type { AppTheme } from "../../themes";

/**
 * Reviewer-facing labels for each drift reason. Phrased as impact ("file
 * removed", "anchor moved") rather than internal state strings
 * ("missing-file", "anchor-mismatch") so the banner reads like prose to
 * someone glancing at it for the first time.
 */
const DRIFT_REASON_LABEL: Record<DriftedCommentSummary["reason"], string> = {
  "missing-file": "file removed",
  "out-of-range": "line no longer exists",
  "anchor-mismatch": "anchor moved",
  "not-in-hunk": "outside current diff",
};

/** Cap the wrapped body of an unfocused drift card so the banner doesn't dominate the diff. */
const COLLAPSED_BODY_LINE_CAP = 2;

const ACCENT_BAR_WIDTH = 1;
const LEFT_INDENT = 2;
const GUTTER_PADDING = 1;
const CARD_CHROME_WIDTH = LEFT_INDENT + ACCENT_BAR_WIDTH + GUTTER_PADDING;

/**
 * Pinned section at the top of the diff view that surfaces user comments
 * whose anchors no longer match the current diff. The section uses the same
 * accent-background file-header shape as a real diff file, so the eye reads
 * "this is another section in the review stream" instead of a free-floating
 * banner. Each drifted entry renders as a left-accented card — mirroring
 * the inline CommentCard so the user only ever sees one comment shape.
 */
export function DriftedCommentsBanner({
  drifted,
  selectedIndex,
  terminalWidth,
  theme,
  onSelect,
}: {
  drifted: DriftedCommentSummary[];
  selectedIndex: number | null;
  terminalWidth: number;
  theme: AppTheme;
  /** Called when the user clicks a drift card; receives the index into `drifted`. */
  onSelect?: (index: number) => void;
}) {
  if (drifted.length === 0) {
    return null;
  }

  const innerWidth = Math.max(8, terminalWidth - 2);
  const bodyWidth = Math.max(1, innerWidth - CARD_CHROME_WIDTH);
  const sorted = sortDrifted(drifted);

  return (
    <box style={{ flexDirection: "column" }}>
      <SectionHeader
        count={drifted.length}
        selectedIndex={selectedIndex}
        terminalWidth={terminalWidth}
        theme={theme}
      />
      {sorted.map((comment) => {
        const focused = selectedIndex !== null && drifted[selectedIndex]?.id === comment.id;
        // `onSelect` is keyed on the original (unsorted) drift array index
        // because callers store `selectedDriftIndex` against that order; if
        // the displayed sort ever diverges further, only the receiver needs
        // to translate, not the banner.
        const driftIndex = drifted.findIndex((entry) => entry.id === comment.id);
        return (
          <box key={comment.id} style={{ width: "100%", flexDirection: "column" }}>
            <DriftedCommentCard
              bodyWidth={bodyWidth}
              comment={comment}
              focused={focused}
              theme={theme}
              onSelect={onSelect ? () => onSelect(driftIndex) : undefined}
            />
            {/* Single normal-background spacer between stacked cards (and one
                trailing the section) so the eye reads each card as its own
                object without padded-banner bulk inside the cards themselves. */}
            <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
              <text>{" ".repeat(Math.max(0, terminalWidth))}</text>
            </box>
          </box>
        );
      })}
    </box>
  );
}

/**
 * Drift section title bar, styled like a `DiffFileHeaderRow` so the section
 * docks visually into the review stream rather than floating above it.
 */
function SectionHeader({
  count,
  selectedIndex,
  terminalWidth,
  theme,
}: {
  count: number;
  selectedIndex: number | null;
  terminalWidth: number;
  theme: AppTheme;
}) {
  const hint =
    selectedIndex === null
      ? "K to focus · D to clear all"
      : `${selectedIndex + 1}/${count} focused · d to delete · J/K to move`;
  const title = `Drifted comments (${count})`;
  const labelWidth = Math.max(1, terminalWidth - hint.length - 4);
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.accentMuted,
      }}
    >
      <text fg={theme.text} bg={theme.accentMuted}>
        {fitText(title, labelWidth)}
      </text>
      <text fg={theme.muted} bg={theme.accentMuted}>
        {hint}
      </text>
    </box>
  );
}

/**
 * One drifted entry rendered with the same left-accent + title + wrapped body
 * shape as the inline `CommentCard`. Unfocused cards cap the body to two
 * lines with an ellipsis marker; the focused card expands to the full body
 * so the user can read the whole comment without leaving the banner.
 */
function DriftedCommentCard({
  bodyWidth,
  comment,
  focused,
  theme,
  onSelect,
}: {
  bodyWidth: number;
  comment: DriftedCommentSummary;
  focused: boolean;
  theme: AppTheme;
  onSelect?: () => void;
}) {
  // `#id · file:line · reason` — `#id` carries the stable handle, the rest
  // reads as quiet metadata in `theme.muted` so the body text below is the
  // visual focus of the card.
  const idLabel = `#${comment.id}`;
  const metadataTail = ` · ${comment.file}:${comment.line} · ${DRIFT_REASON_LABEL[comment.reason]}`;
  const allBodyLines = wrapText(comment.body, bodyWidth);
  const cappedBodyLines = focused
    ? allBodyLines
    : capLines(allBodyLines, COLLAPSED_BODY_LINE_CAP, bodyWidth);
  // Selection state shifts the surface to the title-background tint; the
  // accent bar stays the comment color so "selected" and "comment-ness"
  // don't fight for the same visual signal.
  const surfaceBg = focused ? theme.noteTitleBackground : theme.noteBackground;
  const tailWidth = Math.max(0, bodyWidth - idLabel.length);

  return (
    <box
      style={{ width: "100%", flexDirection: "column", backgroundColor: surfaceBg }}
      onMouseUp={onSelect}
    >
      <CardRow surfaceBg={surfaceBg} theme={theme}>
        <text bg={surfaceBg}>
          <span fg={theme.noteTitleText} bg={surfaceBg}>
            {idLabel}
          </span>
          <span fg={theme.muted} bg={surfaceBg}>
            {padText(fitText(metadataTail, tailWidth), tailWidth)}
          </span>
        </text>
      </CardRow>
      {cappedBodyLines.map((line, index) => (
        <CardRow key={index} surfaceBg={surfaceBg} theme={theme}>
          <text fg={theme.noteTitleText} bg={surfaceBg}>
            {padText(line, bodyWidth)}
          </text>
        </CardRow>
      ))}
    </box>
  );
}

/** Cap wrapped body lines, replacing the last visible line with a trailing ellipsis when truncated. */
function capLines(lines: string[], cap: number, width: number): string[] {
  if (lines.length <= cap) {
    return lines;
  }
  const head = lines.slice(0, cap - 1);
  const trailing = lines[cap - 1] ?? "";
  const ellipsis = " …";
  const truncated = fitText(trailing, Math.max(0, width - ellipsis.length)) + ellipsis;
  return [...head, truncated];
}

/** One row of a drift card: left indent + accent bar + gutter + content. Matches CommentCard. */
function CardRow({
  children,
  surfaceBg,
  theme,
}: {
  children: React.ReactNode;
  surfaceBg: string;
  theme: AppTheme;
}) {
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
      <box style={{ width: LEFT_INDENT, height: 1, backgroundColor: surfaceBg }}>
        <text>{" ".repeat(LEFT_INDENT)}</text>
      </box>
      <box style={{ width: ACCENT_BAR_WIDTH, height: 1, backgroundColor: surfaceBg }}>
        <text fg={theme.accent} bg={surfaceBg}>
          ▎
        </text>
      </box>
      <box style={{ width: GUTTER_PADDING, height: 1, backgroundColor: surfaceBg }}>
        <text>{" ".repeat(GUTTER_PADDING)}</text>
      </box>
      {children}
    </box>
  );
}

/**
 * Spatial-order sort for drift cards: file path, then line within the file,
 * then id as a stable tiebreaker. Insertion order (id-only) read like
 * unrelated noise when the file paths were mixed; a sorted list reads
 * like a mini index of broken anchors.
 */
function sortDrifted(drifted: DriftedCommentSummary[]): DriftedCommentSummary[] {
  return [...drifted].sort((a, b) => {
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.id - b.id;
  });
}
