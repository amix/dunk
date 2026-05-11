import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const parsed = await parseCli(["bun", "dunk"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected top-level help output.");
    }

    expect(parsed.text).toContain("Usage:");
    expect(parsed.text).toContain("dunk diff");
    expect(parsed.text).toContain("dunk show");
    expect(parsed.text).toContain("dunk skill path");
    expect(parsed.text).toContain("dunk comments");
    expect(parsed.text).toContain("Global options:");
    expect(parsed.text).toContain("Common review options:");
    expect(parsed.text).toContain("auto-reload when the current diff input changes");
    expect(parsed.text).toContain("Git diff options:");
    expect(parsed.text).toContain("Notes:");
    expect(parsed.text).toContain(
      "Run `dunk <command> --help` for command-specific syntax and options.",
    );
    expect(parsed.text).not.toContain("Config:");
    expect(parsed.text).not.toContain("Examples:");
  });

  test("prints the same top-level help for --help", async () => {
    const bare = await parseCli(["bun", "dunk"]);
    const explicit = await parseCli(["bun", "dunk", "--help"]);

    expect(explicit).toEqual(bare);
  });

  test("resolves the package version metadata", () => {
    expect(resolveCliVersion()).toBe(require("../../package.json").version);
  });

  test("prints the package version for --version and version", async () => {
    const expectedVersion = require("../../package.json").version;
    const flag = await parseCli(["bun", "dunk", "--version"]);
    const command = await parseCli(["bun", "dunk", "version"]);

    expect(flag).toEqual({ kind: "help", text: `${expectedVersion}\n` });
    expect(command).toEqual(flag);
  });

  test("parses git-style diff mode with shared options", async () => {
    const parsed = await parseCli([
      "bun",
      "dunk",
      "diff",
      "main...feature",
      "--mode",
      "split",
      "--theme",
      "paper",
      "--no-line-numbers",
      "--wrap",
      "--no-hunk-headers",
      "--watch",
    ]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "main...feature",
      staged: false,
      options: {
        mode: "split",
        theme: "paper",
        watch: true,
        lineNumbers: false,
        wrapLines: true,
        hunkHeaders: false,
      },
    });
  });

  test("parses staged git-style diff aliases", async () => {
    const staged = await parseCli(["bun", "dunk", "diff", "--staged"]);
    const cached = await parseCli(["bun", "dunk", "diff", "--cached"]);

    expect(staged).toMatchObject({ kind: "vcs", staged: true });
    expect(cached).toMatchObject({ kind: "vcs", staged: true });
  });

  test("parses untracked file toggles for git diff", async () => {
    const excluded = await parseCli(["bun", "dunk", "diff", "--exclude-untracked"]);
    const included = await parseCli(["bun", "dunk", "diff", "--no-exclude-untracked"]);

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

    const parsed = await parseCli(["bun", "dunk", "diff", left, right, "--mode", "stack"]);

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
      "dunk",
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
    const parsed = await parseCli(["bun", "dunk", "diff", "trunk()..@", ".github"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "trunk()..@",
      pathspecs: [".github"],
    });
  });

  test("parses show mode with optional ref and pathspecs", async () => {
    const parsed = await parseCli(["bun", "dunk", "show", "HEAD~1", "--", "src/app.ts"]);

    expect(parsed).toMatchObject({
      kind: "show",
      ref: "HEAD~1",
      pathspecs: ["src/app.ts"],
    });
  });

  test("treats post-`--` flag-shaped tokens as pathspecs, not view options", async () => {
    const parsed = await parseCli(["bun", "dunk", "diff", "--", "--no-wrap"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      pathspecs: ["--no-wrap"],
    });
    if (parsed.kind === "vcs") {
      expect(parsed.options.wrapLines).toBeUndefined();
    }
  });

  test("parses general pager mode", async () => {
    const parsed = await parseCli(["bun", "dunk", "pager", "--theme", "paper"]);

    expect(parsed).toMatchObject({
      kind: "pager",
      options: {
        theme: "paper",
      },
    });
  });

  test("prints the bundled skill path for dunk skill path", async () => {
    const parsed = await parseCli(["bun", "dunk", "skill", "path"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected bundled skill path output.");
    }

    expect(parsed.text).toEndWith(`${join("skills", "dunk-review", "SKILL.md")}\n`);
  });

  test("prints skill help for dunk skill --help", async () => {
    const parsed = await parseCli(["bun", "dunk", "skill", "--help"]);

    expect(parsed).toEqual({
      kind: "help",
      text: [
        "Usage: dunk skill path",
        "",
        "Print the bundled dunk review skill path.",
        "Load or symlink that file in your coding agent to keep it in sync across dunk upgrades.",
        "",
      ].join("\n"),
    });
  });

  test("parses stash show mode", async () => {
    const parsed = await parseCli(["bun", "dunk", "stash", "show", "stash@{1}"]);

    expect(parsed).toMatchObject({
      kind: "stash-show",
      ref: "stash@{1}",
    });
  });

  test("prints comments help for dunk comments --help", async () => {
    const parsed = await parseCli(["bun", "dunk", "comments", "--help"]);
    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected comments help output.");
    }
    expect(parsed.text).toContain("Usage: dunk comments");
    expect(parsed.text).toContain("list");
    expect(parsed.text).toContain("show");
    expect(parsed.text).toContain("resolve");
  });

  test("rejects unknown comments subcommands", async () => {
    await expect(parseCli(["bun", "dunk", "comments", "wat"])).rejects.toThrow(
      /Unknown `dunk comments` subcommand/,
    );
  });

  test("rejects non-integer ids for dunk comments resolve", async () => {
    await expect(parseCli(["bun", "dunk", "comments", "resolve", "abc"])).rejects.toThrow(
      /positive integer ids/,
    );
  });

  test("rejects removed legacy git alias", async () => {
    await expect(parseCli(["bun", "dunk", "git"])).rejects.toThrow("Unknown command: git");
  });

  test("parses patch mode from a file", async () => {
    const parsed = await parseCli(["bun", "dunk", "patch", "changes.patch", "--pager"]);

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
      "dunk",
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
