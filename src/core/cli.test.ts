import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCli } from "./cli";
import { resolveCliVersion } from "./version";

const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("parseCli", () => {
  test("prints help when no subcommand is passed", async () => {
    const parsed = await parseCli(["bun", "hunk"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected top-level help output.");
    }

    expect(parsed.text).toContain("Usage:");
    expect(parsed.text).toContain("hunk diff");
    expect(parsed.text).toContain("hunk show");
    expect(parsed.text).toContain("hunk skill path");
    expect(parsed.text).toContain("Global options:");
    expect(parsed.text).toContain("Common review options:");
    expect(parsed.text).toContain("auto-reload when the current diff input changes");
    expect(parsed.text).toContain("Git diff options:");
    expect(parsed.text).toContain("Notes:");
    expect(parsed.text).toContain(
      "Run `hunk <command> --help` for command-specific syntax and options.",
    );
    expect(parsed.text).not.toContain("Config:");
    expect(parsed.text).not.toContain("Examples:");
  });

  test("prints the same top-level help for --help", async () => {
    const bare = await parseCli(["bun", "hunk"]);
    const explicit = await parseCli(["bun", "hunk", "--help"]);

    expect(explicit).toEqual(bare);
  });

  test("resolves the package version metadata", () => {
    expect(resolveCliVersion()).toBe(require("../../package.json").version);
  });

  test("prints the package version for --version and version", async () => {
    const expectedVersion = require("../../package.json").version;
    const flag = await parseCli(["bun", "hunk", "--version"]);
    const command = await parseCli(["bun", "hunk", "version"]);

    expect(flag).toEqual({ kind: "help", text: `${expectedVersion}\n` });
    expect(command).toEqual(flag);
  });

  test("parses git-style diff mode with shared options", async () => {
    const parsed = await parseCli([
      "bun",
      "hunk",
      "diff",
      "main...feature",
      "--mode",
      "split",
      "--theme",
      "paper",
      "--agent-context",
      "notes.json",
      "--no-line-numbers",
      "--wrap",
      "--no-hunk-headers",
      "--agent-notes",
      "--watch",
    ]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "main...feature",
      staged: false,
      options: {
        mode: "split",
        theme: "paper",
        agentContext: "notes.json",
        watch: true,
        lineNumbers: false,
        wrapLines: true,
        hunkHeaders: false,
        agentNotes: true,
      },
    });
  });

  test("parses staged git-style diff aliases", async () => {
    const staged = await parseCli(["bun", "hunk", "diff", "--staged"]);
    const cached = await parseCli(["bun", "hunk", "diff", "--cached"]);

    expect(staged).toMatchObject({ kind: "vcs", staged: true });
    expect(cached).toMatchObject({ kind: "vcs", staged: true });
  });

  test("parses untracked file toggles for git diff", async () => {
    const excluded = await parseCli(["bun", "hunk", "diff", "--exclude-untracked"]);
    const included = await parseCli(["bun", "hunk", "diff", "--no-exclude-untracked"]);

    expect(excluded).toMatchObject({
      kind: "vcs",
      staged: false,
      options: {
        excludeUntracked: true,
      },
    });
    expect(included).toMatchObject({
      kind: "vcs",
      staged: false,
      options: {
        excludeUntracked: false,
      },
    });
  });

  test("keeps two concrete file paths as file-pair diff mode", async () => {
    const dir = createTempDir("hunk-cli-files-");
    const left = join(dir, "before.ts");
    const right = join(dir, "after.ts");
    writeFileSync(left, "before\n");
    writeFileSync(right, "after\n");

    const parsed = await parseCli(["bun", "hunk", "diff", left, right, "--mode", "stack"]);

    expect(parsed).toMatchObject({
      kind: "diff",
      left,
      right,
      options: {
        mode: "stack",
      },
    });
  });

  test("parses pathspec-limited git diffs", async () => {
    const parsed = await parseCli([
      "bun",
      "hunk",
      "diff",
      "main",
      "--",
      "src/app.ts",
      "test/app.test.ts",
    ]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "main",
      pathspecs: ["src/app.ts", "test/app.test.ts"],
    });
  });

  test("parses target followed by pathspecs without a separator", async () => {
    const parsed = await parseCli(["bun", "hunk", "diff", "trunk()..@", ".github"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "trunk()..@",
      pathspecs: [".github"],
    });
  });

  test("parses show mode with optional ref and pathspecs", async () => {
    const parsed = await parseCli(["bun", "hunk", "show", "HEAD~1", "--", "src/app.ts"]);

    expect(parsed).toMatchObject({
      kind: "show",
      ref: "HEAD~1",
      pathspecs: ["src/app.ts"],
    });
  });

  test("parses general pager mode", async () => {
    const parsed = await parseCli(["bun", "hunk", "pager", "--theme", "paper"]);

    expect(parsed).toMatchObject({
      kind: "pager",
      options: {
        theme: "paper",
      },
    });
  });

  test("prints the bundled skill path for hunk skill path", async () => {
    const parsed = await parseCli(["bun", "hunk", "skill", "path"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected bundled skill path output.");
    }

    expect(parsed.text).toEndWith(`${join("skills", "hunk-review", "SKILL.md")}\n`);
  });

  test("prints skill help for hunk skill --help", async () => {
    const parsed = await parseCli(["bun", "hunk", "skill", "--help"]);

    expect(parsed).toEqual({
      kind: "help",
      text: [
        "Usage: hunk skill path",
        "",
        "Print the bundled Hunk review skill path.",
        "Load or symlink that file in your coding agent to keep it in sync across Hunk upgrades.",
        "",
      ].join("\n"),
    });
  });


  test("parses stash show mode", async () => {
    const parsed = await parseCli(["bun", "hunk", "stash", "show", "stash@{1}"]);

    expect(parsed).toMatchObject({
      kind: "stash-show",
      ref: "stash@{1}",
    });
  });

  test("rejects removed legacy git alias", async () => {
    await expect(parseCli(["bun", "hunk", "git"])).rejects.toThrow("Unknown command: git");
  });

  test("parses patch mode from a file", async () => {
    const parsed = await parseCli(["bun", "hunk", "patch", "changes.patch", "--pager"]);

    expect(parsed).toMatchObject({
      kind: "patch",
      file: "changes.patch",
      options: {
        pager: true,
      },
    });
    if (parsed.kind !== "patch") {
      throw new Error("Expected patch command input.");
    }

    expect(parsed.options.mode).toBeUndefined();
  });

  test("parses difftool mode with display path", async () => {
    const parsed = await parseCli([
      "bun",
      "hunk",
      "difftool",
      "left.ts",
      "right.ts",
      "src/example.ts",
      "--mode",
      "stack",
    ]);

    expect(parsed).toMatchObject({
      kind: "difftool",
      left: "left.ts",
      right: "right.ts",
      path: "src/example.ts",
      options: {
        mode: "stack",
      },
    });
    if (parsed.kind !== "difftool") {
      throw new Error("Expected difftool command input.");
    }

    expect(parsed.options.pager).toBeUndefined();
  });
});
