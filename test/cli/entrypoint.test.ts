import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bunExecutable = process.execPath;

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    throw new Error(
      Buffer.from(proc.stderr).toString("utf8").trim() || `git ${args.join(" ")} failed`,
    );
  }
}

describe("CLI entrypoint contracts", () => {
  test("bare dunk prints standard help without terminal takeover sequences", () => {
    const proc = Bun.spawnSync([bunExecutable, "run", "src/main.tsx"], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = Buffer.from(proc.stdout).toString("utf8");
    const stderr = Buffer.from(proc.stderr).toString("utf8");

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("dunk diff");
    expect(stdout).toContain("dunk show");
    expect(stdout).toContain("Global options:");
    expect(stdout).toContain("Common review options:");
    expect(stdout).toContain("auto-reload when the current diff input changes");
    expect(stdout).toContain("Git diff options:");
    expect(stdout).toContain("Notes:");
    expect(stdout).toContain(
      "Run `dunk <command> --help` for command-specific syntax and options.",
    );
    expect(stdout).not.toContain("Config:");
    expect(stdout).not.toContain("Examples:");
    expect(stdout).toContain("dunk pager");

    expect(stdout).toContain("dunk skill path");

    expect(stdout).not.toContain("dunk session");
    expect(stdout).not.toContain("dunk daemon");
    expect(stdout).not.toContain("dunk mcp");
    expect(stdout).not.toContain("dunk git");
    expect(stdout).not.toContain("\u001b[?1049h");
  });

  test("prints the package version for --version without terminal takeover sequences", () => {
    const expectedVersion = require("../../package.json").version;
    const proc = Bun.spawnSync([bunExecutable, "run", "src/main.tsx", "--version"], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = Buffer.from(proc.stdout).toString("utf8");
    const stderr = Buffer.from(proc.stderr).toString("utf8");

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${expectedVersion}\n`);
    expect(stdout).not.toContain("\u001b[?1049h");
  });

  test("prints the bundled skill path for dunk skill path without terminal takeover sequences", () => {
    const proc = Bun.spawnSync([bunExecutable, "run", "src/main.tsx", "skill", "path"], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = Buffer.from(proc.stdout).toString("utf8");
    const stderr = Buffer.from(proc.stderr).toString("utf8");
    const resolvedPath = stdout.trim();

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(resolvedPath).toEndWith(join("skills", "dunk-review", "SKILL.md"));
    expect(existsSync(resolvedPath)).toBe(true);
    expect(stdout).not.toContain("\u001b[?1049h");
  });

  test("bin wrapper prints the bundled skill path for dunk skill path", () => {
    const proc = Bun.spawnSync(["node", "bin/dunk.cjs", "skill", "path"], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const stdout = Buffer.from(proc.stdout).toString("utf8");
    const stderr = Buffer.from(proc.stderr).toString("utf8");
    const resolvedPath = stdout.trim();

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(resolvedPath).toEndWith(join("skills", "dunk-review", "SKILL.md"));
    expect(existsSync(resolvedPath)).toBe(true);
  });

  test("bin wrapper fails clearly when the bundled skill is missing", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dunk-wrapper-skill-missing-"));
    const tempBinDir = join(tempDir, "bin");
    const tempWrapperPath = join(tempBinDir, "dunk.cjs");

    try {
      mkdirSync(tempBinDir, { recursive: true });
      copyFileSync(join(process.cwd(), "bin", "dunk.cjs"), tempWrapperPath);

      const proc = Bun.spawnSync(["node", tempWrapperPath, "skill", "path"], {
        cwd: tempDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });

      const stdout = Buffer.from(proc.stdout).toString("utf8");
      const stderr = Buffer.from(proc.stderr).toString("utf8");

      expect(proc.exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("dunk: could not locate the bundled review skill");
      expect(stderr).toContain(join("skills", "dunk-review", "SKILL.md"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("general pager mode falls back to plain text for non-diff stdin", () => {
    const proc = Bun.spawnSync([bunExecutable, "run", "src/main.tsx", "pager"], {
      cwd: process.cwd(),
      stdin: Buffer.from("* main\n  feature/demo\n"),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const stdout = Buffer.from(proc.stdout).toString("utf8");
    const stderr = Buffer.from(proc.stderr).toString("utf8");

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("* main");
    expect(stdout).toContain("feature/demo");
    expect(stdout).not.toContain("View  Navigate  Theme  Agent  Help");
    expect(stdout).not.toContain("\u001b[?1049h");
  });

  test("prints a friendly git-repo error without a Bun stack trace", () => {
    const nonRepoDir = mkdtempSync(join(tmpdir(), "hunk-nonrepo-"));
    const sourceEntrypoint = join(process.cwd(), "src/main.tsx");

    try {
      const proc = Bun.spawnSync([bunExecutable, "run", sourceEntrypoint, "diff"], {
        cwd: nonRepoDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });

      const stdout = Buffer.from(proc.stdout).toString("utf8");
      const stderr = Buffer.from(proc.stderr).toString("utf8");

      expect(proc.exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("dunk: `dunk diff` must be run inside a Git repository.");
      expect(stderr).toContain("dunk diff <before-file> <after-file>");
      expect(stderr).not.toContain("at runGitText");
      expect(stderr).not.toContain("loadGitChangeset");
      expect(stderr).not.toContain("Bun v");
    } finally {
      rmSync(nonRepoDir, { recursive: true, force: true });
    }
  });

  test("prints a friendly invalid-ref error without a Bun stack trace", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hunk-show-cli-"));
    const sourceEntrypoint = join(process.cwd(), "src/main.tsx");

    try {
      git(repoDir, "init");
      git(repoDir, "config", "user.name", "Test User");
      git(repoDir, "config", "user.email", "test@example.com");
      writeFileSync(join(repoDir, "alpha.ts"), "export const alpha = 1;\n");
      git(repoDir, "add", "alpha.ts");
      git(repoDir, "commit", "-m", "initial");

      const proc = Bun.spawnSync([bunExecutable, "run", sourceEntrypoint, "show", "HEAD~999"], {
        cwd: repoDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });

      const stdout = Buffer.from(proc.stdout).toString("utf8");
      const stderr = Buffer.from(proc.stderr).toString("utf8");

      expect(proc.exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("dunk: `dunk show HEAD~999` could not resolve Git ref `HEAD~999`.");
      expect(stderr).toContain("Check the ref name and try again.");
      expect(stderr).not.toContain("runGitText");
      expect(stderr).not.toContain("Bun v");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
