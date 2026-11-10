import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import { formatHunkHeader } from "./hunkHeader";

describe("formatHunkHeader", () => {
  test("rebuilds missing specs from the header counts, including context lines", () => {
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "one\ntwo\nTHREE\nfour\nfive\n";
    const metadata = parseDiffFromFile(
      { name: "a.txt", contents: before, cacheKey: "before" },
      { name: "a.txt", contents: after, cacheKey: "after" },
      { context: 3 },
      true,
    );
    const hunk = metadata.hunks[0]!;

    expect(formatHunkHeader({ ...hunk, hunkSpecs: undefined, hunkContext: undefined })).toBe(
      "@@ -1,5 +1,5 @@",
    );
  });

  test("rebuilds specs for a pure insertion with a zero-count old side", () => {
    const metadata = parseDiffFromFile(
      { name: "new.txt", contents: "", cacheKey: "before" },
      { name: "new.txt", contents: "one\ntwo\n", cacheKey: "after" },
      { context: 3 },
      true,
    );
    const hunk = metadata.hunks[0]!;

    expect(formatHunkHeader({ ...hunk, hunkSpecs: undefined, hunkContext: undefined })).toBe(
      "@@ -0,0 +1,2 @@",
    );
  });
});
