import { describe, expect, test } from "bun:test";
import { createTestDiffFile, lines } from "../../../test/helpers/diff-helpers";
import type { Annotation } from "../../core/types";
import { getAnnotatedHunkIndices, getSelectedAnnotations } from "./agentAnnotations";

function createContextHeavyHunkFile() {
  const beforeLines = Array.from({ length: 25 }, (_, i) => `line${i + 1}`);
  const afterLines = [...beforeLines.slice(0, 12), "INSERTED", ...beforeLines.slice(12)];

  return createTestDiffFile({
    before: lines(...beforeLines),
    after: lines(...afterLines),
    context: 100,
    id: "file:context-heavy-annotation",
    path: "src/sparse.ts",
    previousPath: "src/sparse.ts",
  });
}

describe("agent annotations", () => {
  test("treats annotations anchored on a hunk's added line as visible on that hunk", () => {
    const file = createContextHeavyHunkFile();
    const hunk = file.metadata.hunks[0]!;

    const annotation: Annotation = {
      summary: "Explain inserted line",
      rationale: "Anchor a note at the added row inside a context-heavy hunk.",
      newRange: [13, 13],
    };

    const annotatedFile = {
      ...file,
      annotations: [annotation],
    };

    expect(hunk.additionLines).toBe(1);
    expect([...getAnnotatedHunkIndices(annotatedFile)]).toEqual([0]);
    expect(getSelectedAnnotations(annotatedFile, hunk)).toEqual([annotation]);
  });
});
