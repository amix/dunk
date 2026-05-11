import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeAnchor,
  nextCommentId,
  readCommentsFile,
  resolveComments,
  withAddedComment,
  withRemovedComment,
  withRemovedComments,
  writeCommentsFile,
} from "./comments";
import { DunkUserError } from "./errors";

function withTempRepo<T>(run: (repoRoot: string) => T): T {
  const repoRoot = mkdtempSync(join(tmpdir(), "dunk-comments-"));
  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  try {
    return run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

describe("dunk comments", () => {
  test("computes a deterministic 16-hex anchor for a line plus its neighbours", () => {
    const lines = ["alpha", "beta", "gamma"];
    const anchor = computeAnchor(lines, 2);
    expect(anchor).toMatch(/^[0-9a-f]{16}$/);
    // Same content yields the same anchor (no salt).
    expect(computeAnchor(lines, 2)).toBe(anchor);
    // Editing a neighbour shifts the anchor.
    expect(computeAnchor(["alpha", "beta", "delta"], 2)).not.toBe(anchor);
  });

  test("readCommentsFile returns an empty file when nothing is on disk", () => {
    withTempRepo((repoRoot) => {
      const file = readCommentsFile(repoRoot);
      expect(file.schema).toBe(1);
      expect(file.comments).toEqual([]);
    });
  });

  test("writeCommentsFile is atomic and round-trips through readCommentsFile", () => {
    withTempRepo((repoRoot) => {
      writeCommentsFile(repoRoot, {
        schema: 1,
        comments: [
          {
            id: 1,
            file: "src/a.ts",
            line: 3,
            range: [3, 3],
            anchor: "deadbeefcafef00d",
            body: "hello",
          },
        ],
      });

      const reloaded = readCommentsFile(repoRoot);
      expect(reloaded.comments).toHaveLength(1);
      expect(reloaded.comments[0]).toMatchObject({ id: 1, file: "src/a.ts", line: 3 });

      const tempPath = join(repoRoot, ".dunk", ".comments.json.tmp");
      expect(existsSync(tempPath)).toBe(false);
    });
  });

  test("nextCommentId never reuses an id, even after deletions", () => {
    let file: import("./comments").CommentsFile = { schema: 1, comments: [] };
    file = withAddedComment(file, {
      file: "x.ts",
      line: 1,
      range: [1, 1],
      anchor: "0000000000000000",
      body: "first",
    }).file;
    file = withAddedComment(file, {
      file: "x.ts",
      line: 2,
      range: [2, 2],
      anchor: "1111111111111111",
      body: "second",
    }).file;
    file = withRemovedComment(file, 1);
    expect(nextCommentId(file)).toBe(3);
  });

  test("resolveComments anchors when the line still hashes to the recorded anchor", () => {
    const content = "alpha\nbeta\ngamma\n";
    const lines = content.split("\n").map((line) => line.replace(/\s+$/, ""));
    const anchor = computeAnchor(lines, 2);

    const resolved = resolveComments(
      [{ id: 1, file: "x.ts", line: 2, range: [2, 2], anchor, body: "beta is suspicious" }],
      new Map([["x.ts", content]]),
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.state).toBe("anchored");
  });

  test("resolveComments flags drift when the anchor stops matching", () => {
    const content = "alpha\nbeta-changed\ngamma\n";
    const resolved = resolveComments(
      [{ id: 1, file: "x.ts", line: 2, range: [2, 2], anchor: "deadbeefcafef00d", body: "beta" }],
      new Map([["x.ts", content]]),
    );

    expect(resolved[0]).toMatchObject({ state: "drifted", reason: "anchor-mismatch" });
  });

  test("resolveComments flags drift when the file is missing or the line is out of range", () => {
    const resolved = resolveComments(
      [
        { id: 1, file: "missing.ts", line: 1, range: [1, 1], anchor: "abcd1234efabcd12", body: "" },
        { id: 2, file: "x.ts", line: 99, range: [99, 99], anchor: "abcd1234efabcd12", body: "" },
      ],
      new Map<string, string>([["x.ts", "only one line\n"]]),
    );

    expect(resolved[0]).toMatchObject({ state: "drifted", reason: "missing-file" });
    expect(resolved[1]).toMatchObject({ state: "drifted", reason: "out-of-range" });
  });

  test("withRemovedComments deletes only the requested ids", () => {
    let file: import("./comments").CommentsFile = { schema: 1, comments: [] };
    file = withAddedComment(file, {
      file: "x",
      line: 1,
      range: [1, 1],
      anchor: "aaaaaaaaaaaaaaaa",
      body: "1",
    }).file;
    file = withAddedComment(file, {
      file: "x",
      line: 2,
      range: [2, 2],
      anchor: "bbbbbbbbbbbbbbbb",
      body: "2",
    }).file;
    file = withAddedComment(file, {
      file: "x",
      line: 3,
      range: [3, 3],
      anchor: "cccccccccccccccc",
      body: "3",
    }).file;

    const trimmed = withRemovedComments(file, [1, 3]);
    expect(trimmed.comments.map((c) => c.id)).toEqual([2]);
  });

  test("writeCommentsFile sorts comments by id and pretty-prints with a trailing newline", () => {
    withTempRepo((repoRoot) => {
      writeCommentsFile(repoRoot, {
        schema: 1,
        comments: [
          {
            id: 3,
            file: "z.ts",
            line: 1,
            range: [1, 1],
            anchor: "ccccccccccccccc1",
            body: "third",
          },
          {
            id: 1,
            file: "x.ts",
            line: 1,
            range: [1, 1],
            anchor: "aaaaaaaaaaaaaaa1",
            body: "first",
          },
        ],
      });

      const raw = readFileSync(join(repoRoot, ".dunk", "comments.json"), "utf8");
      expect(raw.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(raw) as { comments: { id: number }[] };
      expect(parsed.comments.map((c) => c.id)).toEqual([1, 3]);
    });
  });

  test("readCommentsFile rejects a future schema version", () => {
    withTempRepo((repoRoot) => {
      mkdirSync(join(repoRoot, ".dunk"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".dunk", "comments.json"),
        JSON.stringify({ schema: 99, comments: [] }),
      );

      expect(() => readCommentsFile(repoRoot)).toThrow(/Unsupported dunk comments schema/);
    });
  });

  test("readCommentsFile fails loudly on malformed JSON", () => {
    withTempRepo((repoRoot) => {
      mkdirSync(join(repoRoot, ".dunk"), { recursive: true });
      writeFileSync(join(repoRoot, ".dunk", "comments.json"), "{ not json");
      expect(() => readCommentsFile(repoRoot)).toThrow(/Malformed JSON in/);
    });
  });

  test("readCommentsFile rejects entries with missing required fields", () => {
    withTempRepo((repoRoot) => {
      mkdirSync(join(repoRoot, ".dunk"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".dunk", "comments.json"),
        JSON.stringify({
          schema: 1,
          comments: [{ id: 1, file: "x.ts", line: 1 }],
        }),
      );
      expect(() => readCommentsFile(repoRoot)).toThrow(/Invalid comment in/);
    });
  });

  test("readCommentsFile rejects out-of-shape ranges", () => {
    withTempRepo((repoRoot) => {
      mkdirSync(join(repoRoot, ".dunk"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".dunk", "comments.json"),
        JSON.stringify({
          schema: 1,
          comments: [
            {
              id: 1,
              file: "x.ts",
              line: 3,
              range: [5, 2],
              anchor: "deadbeefcafef00d",
              body: "swapped range",
            },
          ],
        }),
      );
      // Validate that the user sees the precise zod hint, not a generic "invalid" message.
      try {
        readCommentsFile(repoRoot);
        throw new Error("readCommentsFile should have rejected the swapped range");
      } catch (error) {
        expect(error).toBeInstanceOf(DunkUserError);
        const details = (error as DunkUserError).details.join("\n");
        expect(details).toMatch(/range start must not exceed range end/);
      }
    });
  });

  test("readCommentsFile rejects unknown extra fields", () => {
    withTempRepo((repoRoot) => {
      mkdirSync(join(repoRoot, ".dunk"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".dunk", "comments.json"),
        JSON.stringify({
          schema: 1,
          comments: [
            {
              id: 1,
              file: "x.ts",
              line: 1,
              range: [1, 1],
              anchor: "deadbeefcafef00d",
              body: "ok",
              rationale: "leftover from older shape",
            },
          ],
        }),
      );
      expect(() => readCommentsFile(repoRoot)).toThrow(/Invalid comment in/);
    });
  });
});
