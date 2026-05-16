import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitBranchBase } from "./branchReview";
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

  test("walks the standard fallback list when no remote is configured", () => {
    // setupBranchedRepo creates a repo with no `origin` remote, so the resolver skips both
    // origin/HEAD lookup and the origin/* fallback candidates and lands on local `main`.
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

  test("distinguishes 'no common ancestor' from 'unknown base'", () => {
    // Build an unrelated-history branch so `git merge-base` finds the ref but no shared commits.
    const cwd = createTempDir("dunk-branch-no-ancestor-");
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "a.txt"), "main\n");
    git(cwd, "add", "a.txt");
    git(cwd, "commit", "-q", "-m", "main");

    git(cwd, "checkout", "-q", "--orphan", "orphan");
    git(cwd, "rm", "-q", "-rf", ".");
    writeFileSync(join(cwd, "b.txt"), "orphan\n");
    git(cwd, "add", "b.txt");
    git(cwd, "commit", "-q", "-m", "orphan");

    expect(() =>
      resolveGitBranchBase(buildVcsInput({ branchReview: { explicitBase: "main" } }), { cwd }),
    ).toThrow(/common ancestor/);
  });
});
