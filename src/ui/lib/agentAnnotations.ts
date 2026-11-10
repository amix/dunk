import type { Hunk } from "@pierre/diffs";
import type { Annotation, DiffFile } from "../../core/types";
import { hunkLineRange } from "../../core/hunkRange";

export interface VisibleAgentNote {
  id: string;
  annotation: Annotation;
}

export interface AnnotationAnchor {
  side: "old" | "new";
  lineNumber: number;
}

/** Check whether two inclusive line ranges overlap. */
function overlap(rangeA: [number, number], rangeB: [number, number]) {
  return rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1];
}

/** Check whether an annotation belongs to the visible span of a hunk. */
function annotationOverlapsHunk(annotation: Annotation, hunk: Hunk) {
  const hunkRange = hunkLineRange(hunk);

  if (annotation.newRange && overlap(annotation.newRange, hunkRange.newRange)) {
    return true;
  }

  if (annotation.oldRange && overlap(annotation.oldRange, hunkRange.oldRange)) {
    return true;
  }

  return false;
}

/** Mark which hunks in a file have any inline annotations attached. */
export function getAnnotatedHunkIndices(file: DiffFile | undefined) {
  const annotated = new Set<number>();
  if (!file || file.annotations.length === 0) {
    return annotated;
  }

  file.metadata.hunks.forEach((hunk, index) => {
    if (file.annotations.some((annotation) => annotationOverlapsHunk(annotation, hunk))) {
      annotated.add(index);
    }
  });

  return annotated;
}

/** Resolve the primary visual anchor for an annotation. */
export function annotationAnchor(annotation: Annotation): AnnotationAnchor | null {
  if (annotation.newRange) {
    return {
      side: "new",
      lineNumber: annotation.newRange[0],
    };
  }

  if (annotation.oldRange) {
    return {
      side: "old",
      lineNumber: annotation.oldRange[0],
    };
  }

  return null;
}
