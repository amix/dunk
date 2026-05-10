import { parseDiffFromFile } from "@pierre/diffs";
import type { Annotation, FileAnnotations, DiffFile } from "../../src/core/types";

function collectChangeStats(metadata: DiffFile["metadata"]) {
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

export function lines(...values: string[]) {
  return `${values.join("\n")}\n`;
}

export function createTestFileAnnotations(
  path: string,
  {
    annotations = [
      {
        newRange: [2, 2],
        summary: `Annotation for ${path}`,
        rationale: `Why ${path} changed`,
      },
    ],
  }: {
    annotations?: Annotation[];
  } = {},
): FileAnnotations {
  return {
    path,
    annotations,
  };
}

export function createTestDiffFile({
  after = "const alpha = 10;\nconst beta = 2;\nconst gamma = 30;\nconst stable = true;\n",
  before = "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\nconst stable = true;\n",
  id = "example",
  language = "typescript",
  path = "example.ts",
  previousPath,
  context = 0,
  annotations = null,
}: {
  after?: string;
  before?: string;
  id?: string;
  language?: string;
  path?: string;
  previousPath?: string;
  context?: number;
  annotations?: DiffFile["annotations"] | boolean;
} = {}): DiffFile {
  const metadata = parseDiffFromFile(
    { cacheKey: `${id}:before`, contents: before, name: path },
    { cacheKey: `${id}:after`, contents: after, name: path },
    { context },
    true,
  );

  return {
    annotations:
      annotations === true
        ? createTestFileAnnotations(path)
        : annotations === false
          ? null
          : annotations,
    id,
    language,
    metadata,
    patch: "",
    path,
    previousPath,
    stats: collectChangeStats(metadata),
  };
}

export function createTestHeaderOnlyDiffFile(): DiffFile {
  const file = createTestDiffFile({
    before: "const alpha = 1;\n",
    after: "const alpha = 2;\n",
    id: "header-only",
    path: "header-only.ts",
  });

  return {
    ...file,
    metadata: {
      ...file.metadata,
      isPartial: true,
      hunks: file.metadata.hunks.map((hunk) => ({
        ...hunk,
        additionLines: 0,
        deletionLines: 0,
        hunkContent: [],
      })),
    },
  };
}
