/**
 * Non-interactive `dunk pager` renderer for captured pager hosts.
 *
 * dunk's normal pager integration is a full-screen interactive TUI: Git pipes
 * patch text on stdin and dunk opens the controlling terminal for input. Tools
 * like LazyGit instead invoke a custom pager inside their own panel and
 * advertise a constrained environment (`TERM=dumb`, a non-TTY pipe). Launching
 * the TUI there corrupts the host panel or produces no usable output.
 *
 * This module is the fallback output adapter for those contexts. It is a thin
 * serializer: it reuses dunk's normal parse/plan stack (`loadAppBootstrap` →
 * Pierre `buildStackRows`) and only turns the resulting stack rows into ANSI
 * text. It deliberately does NOT introduce a second diff parser or review
 * model, does not render the comment overlay (pager content is transient), and
 * skips syntax highlighting so a host that re-spawns the pager on every
 * selection stays snappy. All colors come from `themes.ts` — the single source
 * of truth shared with the interactive renderer (see `stackCellPalette` in
 * `src/ui/diff/renderRows.tsx`, which this mirrors for the static path).
 *
 * Known fidelity gap vs. the TUI: a fully blank added/removed line has no
 * spans, so its add/remove background does not extend across the row here.
 * Diff intent is still readable from the colored sign column.
 */
import type { AppBootstrap } from "../core/types";
import { buildStackRows, type DiffRow, type RenderSpan } from "./diff/pierre";
import { resolveTheme, type AppTheme } from "./themes";

const RESET = "\x1b[0m";

/** Build one ANSI truecolor SGR code from a six-digit hex color. */
function ansiColor(channel: "fg" | "bg", hex: string | undefined) {
  const normalized = hex?.replace(/^#/, "");
  if (!normalized || !/^[0-9a-f]{6}$/i.test(normalized)) {
    return "";
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `\x1b[${channel === "fg" ? 38 : 48};2;${red};${green};${blue}m`;
}

/** Wrap one text fragment in foreground/background ANSI colors. */
function colorText(text: string, fg?: string, bg?: string) {
  if (!text) {
    return "";
  }
  const prefix = `${ansiColor("fg", fg)}${ansiColor("bg", bg)}`;
  return prefix ? `${prefix}${text}${RESET}` : text;
}

/** Serialize highlighted code spans, falling back to the row background. */
function serializeSpans(spans: RenderSpan[], rowBg: string) {
  return spans.map((span) => colorText(span.text, span.fg, span.bg ?? rowBg)).join("");
}

/**
 * Stack-view colors per diff cell kind. Mirrors `stackCellPalette` in
 * `renderRows.tsx`; both must read the same `AppTheme` fields so the static
 * pager and the interactive renderer never drift apart.
 */
export function staticStackPalette(kind: "context" | "addition" | "deletion", theme: AppTheme) {
  if (kind === "addition") {
    return { contentBg: theme.addedBg, signColor: theme.addedSignColor };
  }
  if (kind === "deletion") {
    return { contentBg: theme.removedBg, signColor: theme.removedSignColor };
  }
  return { contentBg: theme.contextBg, signColor: theme.muted };
}

const RAIL_MARKER = "▌";

/** Render a header-like row (collapsed gap / hunk header) as ANSI text. */
function renderHeaderLikeRow(text: string, fg: string, theme: AppTheme) {
  return (
    colorText(RAIL_MARKER, theme.lineNumberFg, theme.panelAlt) +
    colorText(text.trimEnd(), fg, theme.panelAlt)
  );
}

/** Render one stacked diff row as ANSI text, or null to skip it. */
function renderStaticRow(
  row: DiffRow,
  theme: AppTheme,
  showLineNumbers: boolean,
  showHunkHeaders: boolean,
): string | null {
  if (row.type === "collapsed") {
    return renderHeaderLikeRow(`··· ${row.text} ···`, theme.muted, theme);
  }

  if (row.type === "hunk-header") {
    return showHunkHeaders ? renderHeaderLikeRow(row.text, theme.badgeNeutral, theme) : null;
  }

  if (row.type !== "stack-line") {
    // Split rows never reach the static pager (it always builds stack rows).
    return null;
  }

  const { cell } = row;
  const palette = staticStackPalette(cell.kind, theme);
  const rail = colorText(RAIL_MARKER, palette.signColor, palette.contentBg);

  let gutter = "";
  if (showLineNumbers) {
    const oldNumber = cell.oldLineNumber ? String(cell.oldLineNumber) : "";
    const newNumber = cell.newLineNumber ? String(cell.newLineNumber) : "";
    gutter = colorText(
      ` ${oldNumber.padStart(5)} ${newNumber.padStart(5)} `,
      theme.lineNumberFg,
      theme.lineNumberBg,
    );
  }

  const sign = colorText(`${cell.sign || " "} `, palette.signColor, palette.contentBg);
  const content = serializeSpans(cell.spans, palette.contentBg);
  return `${rail}${gutter}${sign}${content}`;
}

/**
 * Render a resolved bootstrap as a static ANSI diff for a captured pager host.
 * Reuses the normal parse/plan path; never throws past the caller's fallback.
 */
export function renderStaticDiffPager(bootstrap: AppBootstrap): string {
  const theme = resolveTheme(bootstrap.initialTheme ?? "graphite", null);
  const showLineNumbers = bootstrap.initialShowLineNumbers ?? false;
  const showHunkHeaders = bootstrap.initialShowHunkHeaders ?? true;

  const lines: string[] = [];
  for (const file of bootstrap.changeset.files) {
    lines.push(colorText(` ${file.path} `, theme.text, theme.panelAlt));
    // Static output skips syntax highlighting (null): a captured host
    // re-spawns the pager per selection, so per-invocation WASM init would
    // dominate. Diff intent still reads from add/remove backgrounds.
    for (const row of buildStackRows(file, null, theme)) {
      const rendered = renderStaticRow(row, theme, showLineNumbers, showHunkHeaders);
      if (rendered !== null) {
        lines.push(rendered);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
