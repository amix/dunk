import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitBranchBase, resolveJjBranchBase } from "./branchReview";
import type { VcsCommandInput } from "./types";

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

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    throw new Error(
      Buffer.from(proc.stderr).toString("utf8").trim() || `git ${args.join(" ")} failed`,
    );
  }

  return Buffer.from(proc.stdout).toString("utf8").trim();
}

/**
 * Build a tiny repo with `main` and a `feature` branch that diverged from main after one
 * shared commit — enough for `merge-base` and fallback-ref resolution to do real work.
 */
function setupBranchedRepo(prefix: string) {
  const cwd = createTempDir(prefix);
  git(cwd, "init", "-q", "-b", "main");
  writeFileSync(join(cwd, "a.txt"), "shared\n");
  git(cwd, "add", "a.txt");
  git(cwd, "commit", "-q", "-m", "shared");
  const sharedSha = git(cwd, "rev-parse", "HEAD");

  // Advance main one commit so the merge-base differs from main's tip — that's what the resolver
  // needs to expose to catch regressions where the diff target reverts to "vs main tip".
  writeFileSync(join(cwd, "main-only.txt"), "main\n");
  git(cwd, "add", "main-only.txt");
  git(cwd, "commit", "-q", "-m", "main-only");

  git(cwd, "checkout", "-q", "-b", "feature", sharedSha);
  writeFileSync(join(cwd, "feature.txt"), "feature\n");
  git(cwd, "add", "feature.txt");
  git(cwd, "commit", "-q", "-m", "feature commit");

  return { cwd, sharedSha };
}

function buildVcsInput(overrides: Partial<VcsCommandInput> = {}): VcsCommandInput {
  return {
    kind: "vcs",
    staged: false,
    options: { mode: "auto" },
    ...overrides,
  };
}

describe("resolveGitBranchBase", () => {
  test("uses the explicit CLI base and returns the merge-base SHA", () => {
    const { cwd, sharedSha } = setupBranchedRepo("dunk-branch-explicit-");

    const resolved = resolveGitBranchBase(
      buildVcsInput({ branchReview: { explicitBase: "main" } }),
      { cwd },
    );

    expect(resolved.displayBase).toBe("main");
    expect(resolved.gitMergeBaseSha).toBe(sharedSha);
  });

  test("prefers the configured base when no explicit base is passed", () => {
    const { cwd, sharedSha } = setupBranchedRepo("dunk-branch-configured-");

    const resolved = resolveGitBranchBase(
      buildVcsInput({
        branchReview: {},
        options: { mode: "auto", branchReviewBase: "main" },
      }),
      { cwd },
    );

    expect(resolved.displayBase).toBe("main");
    expect(resolved.gitMergeBaseSha).toBe(sharedSha);
  });

  test("falls back to main when neither flag nor config nor origin/HEAD is available", () => {
    const { cwd, sharedSha } = setupBranchedRepo("dunk-branch-fallback-");

    const resolved = resolveGitBranchBase(buildVcsInput({ branchReview: {} }), { cwd });

    expect(resolved.displayBase).toBe("main");
    expect(resolved.gitMergeBaseSha).toBe(sharedSha);
  });

  test("raises a friendly error when the explicit base cannot be resolved", () => {
    const { cwd } = setupBranchedRepo("dunk-branch-unknown-");

    expect(() =>
      resolveGitBranchBase(buildVcsInput({ branchReview: { explicitBase: "does-not-exist" } }), {
        cwd,
      }),
    ).toThrow(/could not resolve base/);
  });
});

describe("resolveJjBranchBase", () => {
  test("wraps an explicit base in a fork_point revset", () => {
    const resolved = resolveJjBranchBase(
      buildVcsInput({ branchReview: { explicitBase: "origin/main" } }),
    );

    expect(resolved.displayBase).toBe("origin/main");
    expect(resolved.jjFromRevset).toBe('fork_point(@ | "origin/main")');
  });

  test("falls back to trunk() when nothing else is configured", () => {
    const resolved = resolveJjBranchBase(buildVcsInput({ branchReview: {} }));

    expect(resolved.displayBase).toBe("trunk()");
    expect(resolved.jjFromRevset).toBe('fork_point(@ | "trunk()")');
  });

  test("escapes embedded quotes so the revset stays parseable", () => {
    const resolved = resolveJjBranchBase(
      buildVcsInput({ branchReview: { explicitBase: 'weird"name' } }),
    );

    expect(resolved.jjFromRevset).toBe('fork_point(@ | "weird\\"name")');
  });
});
