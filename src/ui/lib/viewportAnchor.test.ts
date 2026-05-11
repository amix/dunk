import { describe, expect, test } from "bun:test";
import type { VisibleAgentNote } from "./agentAnnotations";
import { resolveTheme } from "../themes";
import { buildInStreamFileHeaderHeights } from "./fileSectionLayout";
import { measureDiffSectionGeometry } from "./diffSectionGeometry";
import { findViewportRowAnchor, resolveViewportRowAnchorTop } from "./viewportAnchor";
import { createTestDiffFile, lines } from "../../../test/helpers/diff-helpers";

describe("viewport row anchors", () => {
  const theme = resolveTheme("midnight", null);

  function createChangedFile() {
    return createTestDiffFile({
      after: lines("const alpha = 2;"),
      before: lines("const alpha = 1;"),
      id: "viewport-anchor",
      path: "viewport-anchor.ts",
    });
  }

  test("honors a preferred stable key when a split change row can map to multiple stacked rows", () => {
    const file = createChangedFile();
    const headerHeights = buildInStreamFileHeaderHeights([file]);
    const splitGeometry = measureDiffSectionGeometry(
      file,
      "split",
      false,
      theme,
      [],
      120,
      true,
      false,
    );
    const stackGeometry = measureDiffSectionGeometry(
      file,
      "stack",
      false,
      theme,
      [],
      120,
      true,
      false,
    );
    const splitChangeTop = splitGeometry.rowBounds.find((row) => row.key.includes(":change:"))?.top;
    const stackDeletionTop = stackGeometry.rowBounds.find((row) =>
      row.key.includes(":deletion:"),
    )?.top;
    const stackAdditionTop = stackGeometry.rowBounds.find((row) =>
      row.key.includes(":addition:"),
    )?.top;

    expect(splitChangeTop).toBeDefined();
    expect(stackDeletionTop).toBeDefined();
    expect(stackAdditionTop).toBeDefined();

    const deletionAnchor = findViewportRowAnchor(
      [file],
      [stackGeometry],
      stackDeletionTop!,
      headerHeights,
    );
    const additionAnchor = findViewportRowAnchor(
      [file],
      [stackGeometry],
      stackAdditionTop!,
      headerHeights,
    );

    const splitAsDeletion = findViewportRowAnchor(
      [file],
      [splitGeometry],
      splitChangeTop!,
      headerHeights,
      deletionAnchor?.stableKey,
    );
    const splitAsAddition = findViewportRowAnchor(
      [file],
      [splitGeometry],
      splitChangeTop!,
      headerHeights,
      additionAnchor?.stableKey,
    );

    expect(splitAsDeletion?.stableKey).toBe(deletionAnchor?.stableKey);
    expect(splitAsAddition?.stableKey).toBe(additionAnchor?.stableKey);
  });

  test("round-trips a stacked deletion row through split view without changing the viewport anchor", () => {
    const file = createChangedFile();
    const headerHeights = buildInStreamFileHeaderHeights([file]);
    const splitGeometry = measureDiffSectionGeometry(
      file,
      "split",
      false,
      theme,
      [],
      120,
      true,
      false,
    );
    const stackGeometry = measureDiffSectionGeometry(
      file,
      "stack",
      false,
      theme,
      [],
      120,
      true,
      false,
    );
    const stackDeletionTop = stackGeometry.rowBounds.find((row) =>
      row.key.includes(":deletion:"),
    )?.top;

    expect(stackDeletionTop).toBeDefined();

    const stackDeletionAnchor = findViewportRowAnchor(
      [file],
      [stackGeometry],
      stackDeletionTop!,
      headerHeights,
    );

    expect(stackDeletionAnchor).not.toBeNull();

    const splitTop = resolveViewportRowAnchorTop(
      [file],
      [splitGeometry],
      stackDeletionAnchor!,
      headerHeights,
    );

    expect(splitTop).not.toBeNull();

    const splitAnchor = findViewportRowAnchor(
      [file],
      [splitGeometry],
      splitTop!,
      headerHeights,
      stackDeletionAnchor?.stableKey,
    );
    const roundTripTop = resolveViewportRowAnchorTop(
      [file],
      [stackGeometry],
      splitAnchor!,
      headerHeights,
    );

    expect(roundTripTop).toBe(stackDeletionTop!);
  });

  function createAnnotatedFile() {
    return createTestDiffFile({
      after: lines(
        "const alpha = 2;",
        "const beta = 2;",
        "const gamma = 30;",
        "const stable = true;",
      ),
      before: lines(
        "const alpha = 1;",
        "const beta = 2;",
        "const gamma = 3;",
        "const stable = true;",
      ),
      id: "viewport-anchor-annotated",
      path: "viewport-anchor-annotated.ts",
      annotations: [
        {
          id: "annotation:1",
          newRange: [1, 1],
          summary: "alpha changed",
          rationale: "increment",
        },
      ],
    });
  }

  function buildAgentNotes(file: ReturnType<typeof createAnnotatedFile>): VisibleAgentNote[] {
    return file.annotations.map((annotation, index) => ({
      id: `annotation:${file.id}:${annotation.id ?? index}`,
      annotation,
    }));
  }

  test("preferDiffRows skips an inline-note row at the viewport top in favor of the nearest diff row", () => {
    const file = createAnnotatedFile();
    const headerHeights = buildInStreamFileHeaderHeights([file]);
    const notes = buildAgentNotes(file);
    const geometry = measureDiffSectionGeometry(
      file,
      "stack",
      false,
      theme,
      notes,
      120,
      true,
      false,
    );
    const inlineNoteRow = geometry.rowBounds.find((row) => row.kind === "inline-note");

    expect(inlineNoteRow).toBeDefined();

    const naiveAnchor = findViewportRowAnchor(
      [file],
      [geometry],
      inlineNoteRow!.top,
      headerHeights,
    );
    const survivableAnchor = findViewportRowAnchor(
      [file],
      [geometry],
      inlineNoteRow!.top,
      headerHeights,
      undefined,
      { preferDiffRows: true },
    );

    expect(naiveAnchor?.stableKey.startsWith("inline-note:")).toBe(true);
    expect(survivableAnchor).not.toBeNull();
    expect(survivableAnchor!.stableKey.startsWith("inline-note:")).toBe(false);
    expect(geometry.rowBoundsByStableKey.get(survivableAnchor!.stableKey)?.kind).toBe("diff-row");
  });

  test("resolveViewportRowAnchorTop returns null when an inline-note anchor is removed by deleting the comment", () => {
    const annotatedFile = createAnnotatedFile();
    const annotatedHeaderHeights = buildInStreamFileHeaderHeights([annotatedFile]);
    const annotatedGeometry = measureDiffSectionGeometry(
      annotatedFile,
      "stack",
      false,
      theme,
      buildAgentNotes(annotatedFile),
      120,
      true,
      false,
    );
    const inlineNoteRow = annotatedGeometry.rowBounds.find((row) => row.kind === "inline-note");

    expect(inlineNoteRow).toBeDefined();

    const noteAnchor = findViewportRowAnchor(
      [annotatedFile],
      [annotatedGeometry],
      inlineNoteRow!.top,
      annotatedHeaderHeights,
    );

    expect(noteAnchor?.stableKey.startsWith("inline-note:")).toBe(true);

    const cleanedFile = { ...annotatedFile, annotations: [] };
    const cleanedHeaderHeights = buildInStreamFileHeaderHeights([cleanedFile]);
    const cleanedGeometry = measureDiffSectionGeometry(
      cleanedFile,
      "stack",
      false,
      theme,
      [],
      120,
      true,
      false,
    );

    const restoredTop = resolveViewportRowAnchorTop(
      [cleanedFile],
      [cleanedGeometry],
      noteAnchor!,
      cleanedHeaderHeights,
    );

    expect(restoredTop).toBeNull();
  });

  test("preferDiffRows yields a survivable anchor that resolves cleanly after a comment deletion", () => {
    const annotatedFile = createAnnotatedFile();
    const annotatedHeaderHeights = buildInStreamFileHeaderHeights([annotatedFile]);
    const annotatedGeometry = measureDiffSectionGeometry(
      annotatedFile,
      "stack",
      false,
      theme,
      buildAgentNotes(annotatedFile),
      120,
      true,
      false,
    );
    const inlineNoteRow = annotatedGeometry.rowBounds.find((row) => row.kind === "inline-note");

    expect(inlineNoteRow).toBeDefined();

    const survivableAnchor = findViewportRowAnchor(
      [annotatedFile],
      [annotatedGeometry],
      inlineNoteRow!.top,
      annotatedHeaderHeights,
      undefined,
      { preferDiffRows: true },
    );

    expect(survivableAnchor).not.toBeNull();

    const cleanedFile = { ...annotatedFile, annotations: [] };
    const cleanedHeaderHeights = buildInStreamFileHeaderHeights([cleanedFile]);
    const cleanedGeometry = measureDiffSectionGeometry(
      cleanedFile,
      "stack",
      false,
      theme,
      [],
      120,
      true,
      false,
    );

    const restoredTop = resolveViewportRowAnchorTop(
      [cleanedFile],
      [cleanedGeometry],
      survivableAnchor!,
      cleanedHeaderHeights,
    );

    expect(restoredTop).not.toBeNull();
    expect(typeof restoredTop).toBe("number");
  });

  test("inline-note anchor survives a comment edit that changes the card height", () => {
    const annotatedFile = createAnnotatedFile();
    const headerHeights = buildInStreamFileHeaderHeights([annotatedFile]);
    // A narrow width forces card prose to wrap so the edited rationale guarantees a height bump,
    // rather than relying on incidental layout coincidence.
    const cardWidth = 40;
    const beforeGeometry = measureDiffSectionGeometry(
      annotatedFile,
      "stack",
      false,
      theme,
      buildAgentNotes(annotatedFile),
      cardWidth,
      true,
      false,
    );
    const inlineNoteRowBefore = beforeGeometry.rowBounds.find((row) => row.kind === "inline-note");

    expect(inlineNoteRowBefore).toBeDefined();

    // Without `preferDiffRows`, the helper picks the inline-note row as the anchor when the
    // viewport top sits inside the card. That id-keyed anchor must continue to resolve after a
    // comment body edit so the reader's position inside the card is preserved.
    const noteAnchor = findViewportRowAnchor(
      [annotatedFile],
      [beforeGeometry],
      inlineNoteRowBefore!.top,
      headerHeights,
    );

    expect(noteAnchor?.stableKey.startsWith("inline-note:")).toBe(true);

    const editedFile = {
      ...annotatedFile,
      annotations: annotatedFile.annotations.map((annotation) => ({
        ...annotation,
        rationale: `${annotation.rationale ?? ""} — extended with substantially more prose so the rendered comment card definitely wraps to additional rows`,
      })),
    };
    const editedGeometry = measureDiffSectionGeometry(
      editedFile,
      "stack",
      false,
      theme,
      buildAgentNotes(editedFile),
      cardWidth,
      true,
      false,
    );
    const inlineNoteRowAfter = editedGeometry.rowBounds.find((row) => row.kind === "inline-note");

    expect(inlineNoteRowAfter).toBeDefined();
    expect(inlineNoteRowAfter!.height).toBeGreaterThan(inlineNoteRowBefore!.height);

    const restoredTop = resolveViewportRowAnchorTop(
      [editedFile],
      [editedGeometry],
      noteAnchor!,
      headerHeights,
    );

    expect(restoredTop).not.toBeNull();
    expect(typeof restoredTop).toBe("number");
  });

  test("resolveViewportRowAnchorTop returns null when the anchored file is no longer present", () => {
    const file = createChangedFile();
    const headerHeights = buildInStreamFileHeaderHeights([file]);
    const geometry = measureDiffSectionGeometry(file, "stack", false, theme, [], 120, true, false);
    const firstRowTop = geometry.rowBounds[0]?.top ?? 0;
    const anchor = findViewportRowAnchor([file], [geometry], firstRowTop, headerHeights);

    expect(anchor).not.toBeNull();

    const otherFile = createTestDiffFile({
      after: lines("const beta = 2;"),
      before: lines("const beta = 1;"),
      id: "other-file",
      path: "other-file.ts",
    });
    const otherHeaderHeights = buildInStreamFileHeaderHeights([otherFile]);
    const otherGeometry = measureDiffSectionGeometry(
      otherFile,
      "stack",
      false,
      theme,
      [],
      120,
      true,
      false,
    );

    const restoredTop = resolveViewportRowAnchorTop(
      [otherFile],
      [otherGeometry],
      anchor!,
      otherHeaderHeights,
    );

    expect(restoredTop).toBeNull();
  });
});
