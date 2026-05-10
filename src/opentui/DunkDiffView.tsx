import { useMemo } from "react";
import { patchLooksBinary } from "../core/binary";
import { normalizeDiffMetadataPaths, normalizeDiffPath } from "../core/diffPaths";
import type { DiffFile } from "../core/types";
import { findMaxLineNumber } from "../ui/diff/codeColumns";
import { buildSplitRows, buildStackRows } from "../ui/diff/pierre";
import { diffMessage, DiffRowView, fitText } from "../ui/diff/renderRows";
import { useHighlightedDiff } from "../ui/diff/useHighlightedDiff";
import { resolveTheme } from "../ui/themes";
import type { DunkDiffFile, DunkDiffViewProps } from "./types";

/** Count visible additions and deletions from Pierre metadata for the internal file adapter. */
function countDiffStats(metadata: DunkDiffFile["metadata"]) {
  let additions = 0;
  let deletions = 0;

  for (const hunk of metadata.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "change") {
        additions += content.additions;
        deletions += content.deletions;
      }
    }
  }

  return { additions, deletions };
}

/** Adapt the public diff shape into dunk's internal file model without exposing app-only fields. */
function toInternalDiffFile(diff: DunkDiffFile): DiffFile {
  const patch = diff.patch ?? "";
  const metadata = normalizeDiffMetadataPaths(diff.metadata);
  const path = normalizeDiffPath(diff.path) ?? metadata.name;

  return {
    annotations: null,
    id: diff.id,
    isBinary: patchLooksBinary(patch),
    language: diff.language,
    metadata,
    patch,
    path,
    previousPath: metadata.prevName,
    stats: countDiffStats(metadata),
  };
}

/** Render one diff file body with dunk's terminal-native OpenTUI renderer. */
export function DunkDiffView({
  diff,
  layout = "split",
  width,
  theme = "graphite",
  showLineNumbers = true,
  showHunkHeaders = true,
  wrapLines = false,
  horizontalOffset = 0,
  highlight = true,
  scrollable = true,
  selectedHunkIndex = 0,
}: DunkDiffViewProps) {
  const resolvedTheme = resolveTheme(theme, null);
  const internalDiff = useMemo(() => (diff ? toInternalDiffFile(diff) : undefined), [diff]);
  const resolvedHighlighted = useHighlightedDiff({
    file: internalDiff,
    appearance: resolvedTheme.appearance,
    shouldLoadHighlight: highlight,
  });
  const rows = useMemo(
    () =>
      internalDiff
        ? layout === "split"
          ? buildSplitRows(internalDiff, resolvedHighlighted, resolvedTheme)
          : buildStackRows(internalDiff, resolvedHighlighted, resolvedTheme)
        : [],
    [internalDiff, layout, resolvedHighlighted, resolvedTheme],
  );
  const lineNumberDigits = useMemo(
    () => String(internalDiff ? findMaxLineNumber(internalDiff) : 1).length,
    [internalDiff],
  );

  if (!internalDiff) {
    return (
      <box style={{ width: "100%", paddingLeft: 1, paddingRight: 1 }}>
        <text fg={resolvedTheme.muted}>{fitText("No file selected.", Math.max(1, width - 2))}</text>
      </box>
    );
  }

  if (internalDiff.metadata.hunks.length === 0) {
    return (
      <box style={{ width: "100%", paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
        <text fg={resolvedTheme.muted}>
          {fitText(diffMessage(internalDiff), Math.max(1, width - 2))}
        </text>
      </box>
    );
  }

  const content = (
    <box style={{ width: "100%", flexDirection: "column" }}>
      {rows.map((row) => (
        <box key={row.key} style={{ width: "100%", flexDirection: "column" }}>
          <DiffRowView
            row={row}
            width={width}
            lineNumberDigits={lineNumberDigits}
            showLineNumbers={showLineNumbers}
            showHunkHeaders={showHunkHeaders}
            wrapLines={wrapLines}
            codeHorizontalOffset={horizontalOffset}
            theme={resolvedTheme}
            selected={row.hunkIndex === selectedHunkIndex}
            annotated={false}
          />
        </box>
      ))}
    </box>
  );

  if (!scrollable) {
    return content;
  }

  return (
    <scrollbox width="100%" height="100%" scrollY={true} viewportCulling={true} focused={false}>
      {content}
    </scrollbox>
  );
}
