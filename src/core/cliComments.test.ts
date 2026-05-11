import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeAnchor, readCommentsFile, splitLines, writeCommentsFile } from "./comments";
import {
  renderCommentsHelp,
  runCommentsList,
  runCommentsResolve,
  runCommentsShow,
} from "./cliComments";
import { DunkUserError } from "./errors";

const tempDirs: string[] = [];

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "dunk-cli-comments-"));
  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  tempDirs.push(repoRoot);
  return repoRoot;
}

function writeRepoFile(repoRoot: string, relPath: string, content: string) {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("dunk comments CLI", () => {
  test("list reports the empty state when nothing is pending", () => {
    const repoRoot = createTempRepo();
    expect(runCommentsList("text", { cwd: repoRoot })).toBe("No pending comments.\n");
  });

  test("list prints anchored comments without drift markers", () => {
    const repoRoot = createTempRepo();
    const content = "alpha\nbeta\ngamma\n";
    writeRepoFile(repoRoot, "src/a.ts", content);
    const lines = splitLines(content);
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 1,
          file: "src/a.ts",
          line: 2,
          range: [1, 3],
          anchor: computeAnchor(lines, 2),
          body: "ship it",
        },
      ],
    });

    const output = runCommentsList("text", { cwd: repoRoot });
    expect(output).toContain("1 comment:");
    expect(output).toContain("#1  src/a.ts:1-3");
    expect(output).not.toContain("drifted");
    expect(output).toContain("    ship it");
  });

  test("list flags drifted comments with the drift reason", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "src/a.ts", "alpha\nbeta\ngamma\n");
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 7,
          file: "src/missing.ts",
          line: 1,
          range: [1, 1],
          anchor: "deadbeefcafef00d",
          body: "where did this go?",
        },
      ],
    });

    const output = runCommentsList("text", { cwd: repoRoot });
    expect(output).toContain("#7  src/missing.ts:1  drifted: missing-file");
  });

  test("list --json emits a stable shape with state and reason", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "src/a.ts", "alpha\nbeta\ngamma\n");
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 7,
          file: "src/missing.ts",
          line: 1,
          range: [1, 1],
          anchor: "deadbeefcafef00d",
          body: "drifted entry",
        },
      ],
    });

    const parsed = JSON.parse(runCommentsList("json", { cwd: repoRoot }));
    expect(parsed).toEqual({
      schema: 1,
      comments: [
        {
          id: 7,
          file: "src/missing.ts",
          line: 1,
          range: [1, 1],
          anchor: "deadbeefcafef00d",
          body: "drifted entry",
          state: "drifted",
          reason: "missing-file",
        },
      ],
    });
  });

  test("show prints the comment, hunk lines, and surrounding context", () => {
    const repoRoot = createTempRepo();
    const content = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join("\n");
    writeRepoFile(repoRoot, "src/a.ts", content);
    const lines = splitLines(content);
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 3,
          file: "src/a.ts",
          line: 15,
          range: [14, 15],
          anchor: computeAnchor(lines, 15),
          body: "rename these",
        },
      ],
    });

    const output = runCommentsShow(3, "text", { cwd: repoRoot });
    expect(output).toContain("#3  src/a.ts:14-15");
    expect(output).toContain("    rename these");
    // Context lines are prefixed with a space; in-range lines with `>`.
    expect(output).toContain("> 14  line-14");
    expect(output).toContain("> 15  line-15");
    expect(output).toContain("  5  line-5");
    expect(output).toContain(" 25  line-25");
    // Window edges note how many lines were elided on either side.
    expect(output).toContain("3 earlier lines elided");
    expect(output).toContain("5 later lines elided");
  });

  test("show respects an explicit --context window", () => {
    const repoRoot = createTempRepo();
    const content = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join("\n");
    writeRepoFile(repoRoot, "src/a.ts", content);
    const lines = splitLines(content);
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 3,
          file: "src/a.ts",
          line: 15,
          range: [15, 15],
          anchor: computeAnchor(lines, 15),
          body: "tighter view",
        },
      ],
    });

    const output = runCommentsShow(3, "text", { cwd: repoRoot, contextLines: 1 });
    expect(output).toContain("> 15  line-15");
    expect(output).toContain("  14  line-14");
    expect(output).toContain("  16  line-16");
    expect(output).not.toContain("line-13");
    expect(output).not.toContain("line-17");
  });

  test("show errors when the id is missing", () => {
    const repoRoot = createTempRepo();
    expect(() => runCommentsShow(99, "text", { cwd: repoRoot })).toThrow(
      /No dunk comment with id 99/,
    );
  });

  test("show marks the relocated lines after fuzzy anchor recovery", () => {
    const repoRoot = createTempRepo();
    // Original anchor is the line `c`; the comment range covers `b` and `c`.
    // After inserting `INSERT` at the top, the relocated anchor is one line
    // down — so `show` must mark lines 3-4 (the new positions of b/c), not
    // the stale 2-3 the comment was authored against.
    const original = "a\nb\nc\nd\n";
    writeRepoFile(repoRoot, "target.ts", `INSERT\n${original}`);
    const originalLines = splitLines(original);
    const anchor = computeAnchor(originalLines, 3); // hash around b/c/d at line 3 of original
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 1,
          file: "target.ts",
          line: 3,
          range: [2, 3],
          anchor,
          body: "comment should stay on c",
        },
      ],
    });

    const text = runCommentsShow(1, "text", { cwd: repoRoot, contextLines: 0 });
    expect(text).toContain("> 3  b");
    expect(text).toContain("> 4  c");
    expect(text).not.toContain("> 2  a");
  });

  test("absolute paths in comments cannot leak files outside the repo", () => {
    const repoRoot = createTempRepo();
    const outside = mkdtempSync(join(tmpdir(), "dunk-cli-outside-"));
    tempDirs.push(outside);
    const secretPath = join(outside, "outside-secret.txt");
    writeFileSync(secretPath, "TOP_SECRET_TOKEN", "utf8");

    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 1,
          file: secretPath,
          line: 1,
          range: [1, 1],
          anchor: "0000000000000000",
          body: "absolute path leak",
        },
      ],
    });

    const list = runCommentsList("text", { cwd: repoRoot });
    expect(list).toContain("drifted: missing-file");
    expect(list).not.toContain("TOP_SECRET_TOKEN");

    const show = runCommentsShow(1, "text", { cwd: repoRoot });
    expect(show).not.toContain("TOP_SECRET_TOKEN");
    expect(show).toContain("file unavailable");
  });

  test("`..`-escaping paths in comments are also rejected", () => {
    const repoRoot = createTempRepo();
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        {
          id: 1,
          file: "../etc/passwd",
          line: 1,
          range: [1, 1],
          anchor: "0000000000000000",
          body: "traversal",
        },
      ],
    });

    const list = runCommentsList("text", { cwd: repoRoot });
    expect(list).toContain("drifted: missing-file");
  });

  test("resolve surfaces a missing id even when a concurrent writer beats us", () => {
    const repoRoot = createTempRepo();
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        { id: 1, file: "a.ts", line: 1, range: [1, 1], anchor: "a", body: "first" },
        { id: 2, file: "b.ts", line: 1, range: [1, 1], anchor: "b", body: "second" },
      ],
    });

    // Simulate the TUI deleting comment #2 while the agent's resolve was
    // already in flight: hand the agent a stale read of the file with
    // both ids present, then between read and write swap to the new state.
    // The optimistic loop should re-read, see #2 is gone, and fail loudly.
    const repoBefore = repoRoot;
    writeCommentsFile(repoBefore, {
      schema: 1,
      comments: [{ id: 1, file: "a.ts", line: 1, range: [1, 1], anchor: "a", body: "first" }],
    });

    expect(() => runCommentsResolve([2], { cwd: repoRoot })).toThrow(/No dunk comment with id #2/);
  });

  test("resolve removes one comment and writes the file atomically", () => {
    const repoRoot = createTempRepo();
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        { id: 1, file: "a.ts", line: 1, range: [1, 1], anchor: "a", body: "first" },
        { id: 2, file: "b.ts", line: 1, range: [1, 1], anchor: "b", body: "second" },
      ],
    });

    const output = runCommentsResolve([1], { cwd: repoRoot });
    expect(output).toBe("Resolved 1 comment: #1.\n");

    const remaining = readCommentsFile(repoRoot);
    expect(remaining.comments.map((c) => c.id)).toEqual([2]);
  });

  test("resolve handles multiple ids in one atomic write", () => {
    const repoRoot = createTempRepo();
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [
        { id: 1, file: "a.ts", line: 1, range: [1, 1], anchor: "a", body: "first" },
        { id: 2, file: "b.ts", line: 1, range: [1, 1], anchor: "b", body: "second" },
        { id: 3, file: "c.ts", line: 1, range: [1, 1], anchor: "c", body: "third" },
      ],
    });

    const output = runCommentsResolve([1, 3], { cwd: repoRoot });
    expect(output).toBe("Resolved 2 comments: #1, #3.\n");

    const remaining = readCommentsFile(repoRoot);
    expect(remaining.comments.map((c) => c.id)).toEqual([2]);
  });

  test("resolve refuses partial success when one id is missing", () => {
    const repoRoot = createTempRepo();
    writeCommentsFile(repoRoot, {
      schema: 1,
      comments: [{ id: 1, file: "a.ts", line: 1, range: [1, 1], anchor: "a", body: "first" }],
    });

    expect(() => runCommentsResolve([1, 99], { cwd: repoRoot })).toThrow(
      /No dunk comment with id #99/,
    );

    const remaining = readCommentsFile(repoRoot);
    expect(remaining.comments.map((c) => c.id)).toEqual([1]);
  });

  test("resolve rejects empty id lists", () => {
    const repoRoot = createTempRepo();
    expect(() => runCommentsResolve([], { cwd: repoRoot })).toThrow(DunkUserError);
  });

  test("commands fail clearly when the cwd is not a repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "dunk-cli-no-repo-"));
    tempDirs.push(dir);
    expect(() => runCommentsList("text", { cwd: dir })).toThrow(/git or jj repository/);
  });

  test("renderCommentsHelp lists every subcommand", () => {
    const help = renderCommentsHelp();
    expect(help).toContain("dunk comments");
    expect(help).toContain("list");
    expect(help).toContain("show");
    expect(help).toContain("resolve");
    expect(help).toContain("--json");
  });
});
