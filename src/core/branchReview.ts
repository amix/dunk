import { DunkUserError } from "./errors";
import { runGitText } from "./git";
import type { VcsCommandInput } from "./types";

/**
 * Refs the resolver tries in order when neither the CLI flag nor config names a base.
 * Plain `merge-base` is used at the call site — `--fork-point` is intentionally avoided
 * because its reflog dependency makes results machine-local.
 */
const GIT_BASE_FALLBACK_REFS = [
  "origin/HEAD",
  "origin/main",
  "main",
  "origin/master",
  "master",
  "origin/trunk",
  "trunk",
] as const;

/**
 * One resolved branch base, suitable for feeding back into the existing diff path.
 *
 * - `displayBase` is what we show to the user (e.g. "origin/main").
 * - `gitMergeBaseSha` is the SHA of `git merge-base <displayBase> HEAD`, used as the diff target
 *   so the diff is "working tree vs the common ancestor" rather than "working tree vs the tip".
 * - `jjFromRevset` is the `--from` argument for `jj diff` — `fork_point(<displayBase>)`, which
 *   gives the same merge-base semantics that GitHub's three-dot view uses.
 */
export interface ResolvedBranchBase {
  displayBase: string;
  gitMergeBaseSha?: string;
  jjFromRevset?: string;
}

/** Trim and discard one-line output from `git rev-parse` / `git merge-base`. */
function firstNonEmptyLine(stdout: string) {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

/** Return the first base ref that `git rev-parse --verify` resolves. */
function pickFirstResolvableGitRef(
  input: VcsCommandInput,
  candidates: readonly string[],
  cwd: string,
  gitExecutable: string,
) {
  for (const candidate of candidates) {
    try {
      const sha = firstNonEmptyLine(
        runGitText({
          input,
          args: ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
          cwd,
          gitExecutable,
        }),
      );

      if (sha) {
        return candidate;
      }
    } catch {
      // Try the next fallback. `git rev-parse --verify` exits non-zero for unknown refs and
      // dunk's runGitText surfaces that as a DunkUserError; we want to keep searching instead.
    }
  }

  return undefined;
}

/** Resolve `git symbolic-ref refs/remotes/origin/HEAD` into the branch name it points at. */
function resolveOriginHead(
  input: VcsCommandInput,
  cwd: string,
  gitExecutable: string,
): string | undefined {
  try {
    const target = firstNonEmptyLine(
      runGitText({
        input,
        args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        cwd,
        gitExecutable,
      }),
    );
    if (!target) {
      return undefined;
    }

    // `git symbolic-ref` returns e.g. `refs/remotes/origin/main`. Strip the `refs/remotes/` prefix
    // so the user-facing base name reads like the branch they'd type by hand.
    return target.startsWith("refs/remotes/") ? target.slice("refs/remotes/".length) : target;
  } catch {
    return undefined;
  }
}

/** Return the `<base> ^HEAD` merge-base SHA used as the diff target. Throws if the base is unknown. */
function runGitMergeBase(input: VcsCommandInput, base: string, cwd: string, gitExecutable: string) {
  return firstNonEmptyLine(
    runGitText({
      input,
      args: ["merge-base", base, "HEAD"],
      cwd,
      gitExecutable,
    }),
  );
}

function createNoBaseFoundError() {
  return new DunkUserError(
    "`dunk diff --branch` could not find a base branch to compare against.",
    [
      "Pass one explicitly (`dunk diff --branch=origin/main`),",
      'or set `[branch_review] base = "origin/main"` in `.dunk/config.toml`.',
    ],
  );
}

function createBaseNotFoundError(base: string) {
  return new DunkUserError(`\`dunk diff --branch\` could not resolve base \`${base}\`.`, [
    "Check the ref name (run `git fetch` if it lives on a remote you have not pulled yet).",
  ]);
}

function createMissingMergeBaseError(base: string) {
  return new DunkUserError(
    `\`dunk diff --branch\` could not find a common ancestor between \`HEAD\` and \`${base}\`.`,
    ["Verify the base shares history with the current branch, or pass a different base."],
  );
}

/** Resolve a Git branch-review base into a concrete merge-base SHA. */
export function resolveGitBranchBase(
  input: VcsCommandInput,
  { cwd = process.cwd(), gitExecutable = "git" }: { cwd?: string; gitExecutable?: string } = {},
): ResolvedBranchBase {
  const explicitBase = input.branchReview?.explicitBase;
  const configuredBase = input.options.branchReviewBase;

  if (explicitBase) {
    const sha = (() => {
      try {
        return runGitMergeBase(input, explicitBase, cwd, gitExecutable);
      } catch {
        throw createBaseNotFoundError(explicitBase);
      }
    })();
    if (!sha) {
      throw createMissingMergeBaseError(explicitBase);
    }

    return { displayBase: explicitBase, gitMergeBaseSha: sha };
  }

  if (configuredBase) {
    const sha = (() => {
      try {
        return runGitMergeBase(input, configuredBase, cwd, gitExecutable);
      } catch {
        throw createBaseNotFoundError(configuredBase);
      }
    })();
    if (!sha) {
      throw createMissingMergeBaseError(configuredBase);
    }

    return { displayBase: configuredBase, gitMergeBaseSha: sha };
  }

  const originHead = resolveOriginHead(input, cwd, gitExecutable);
  const candidates = originHead
    ? [originHead, ...GIT_BASE_FALLBACK_REFS.filter((ref) => ref !== originHead)]
    : [...GIT_BASE_FALLBACK_REFS];

  const detected = pickFirstResolvableGitRef(input, candidates, cwd, gitExecutable);
  if (!detected) {
    throw createNoBaseFoundError();
  }

  const sha = runGitMergeBase(input, detected, cwd, gitExecutable);
  if (!sha) {
    throw createMissingMergeBaseError(detected);
  }

  return { displayBase: detected, gitMergeBaseSha: sha };
}

/** Build the Jujutsu `fork_point` revset used as the `--from` argument for branch review. */
function jjForkPointRevset(base: string) {
  // Jujutsu's revset language uses double quotes for literal strings, so wrap whatever the user
  // (or config) named so revsets with slashes or hyphens — e.g. "origin/main" — parse cleanly.
  const escaped = base.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `fork_point(@ | "${escaped}")`;
}

/** Resolve a Jujutsu branch-review base. */
export function resolveJjBranchBase(input: VcsCommandInput): ResolvedBranchBase {
  const explicitBase = input.branchReview?.explicitBase;
  const configuredBase = input.options.branchReviewBase;
  const base = explicitBase ?? configuredBase ?? "trunk()";

  // For Jujutsu we keep resolution lazy: the actual revset evaluation happens inside `jj diff`,
  // which already raises a clear "Revision not found" / "Failed to parse revset" error when the
  // base is unresolvable. Catching that here would duplicate jj.ts error translation.
  return {
    displayBase: base,
    jjFromRevset: jjForkPointRevset(base),
  };
}
