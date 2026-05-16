import { DunkUserError } from "./errors";
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
 */
export interface ResolvedBranchBase {
  displayBase: string;
  gitMergeBaseSha?: string;
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

interface GitProbeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a short git probe and surface the raw exit code, stdout, and stderr.
 *
 * The resolver bypasses `runGitText` here on purpose: that helper translates non-zero exits into
 * `DunkUserError` with a flattened message, which loses the signal we need to distinguish "ref
 * does not exist" (exit 1 / empty stdout under `--quiet`) from real failures like a corrupt repo
 * or missing executable.
 */
function probeGit(args: string[], cwd: string, gitExecutable: string): GitProbeResult {
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync([gitExecutable, ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable not found in $PATH")) {
      throw new DunkUserError(
        `Git is required for \`dunk diff --branch\`, but \`${gitExecutable}\` was not found in PATH.`,
        ["Install Git or make it available on PATH, then try again."],
      );
    }

    throw error instanceof Error ? error : new Error(String(error));
  }

  return {
    exitCode: proc.exitCode ?? 0,
    stdout: Buffer.from(proc.stdout ?? []).toString("utf8"),
    stderr: Buffer.from(proc.stderr ?? []).toString("utf8"),
  };
}

/** Return the SHA the ref resolves to, or `undefined` when Git reports the ref does not exist. */
function probeGitRefExists(ref: string, cwd: string, gitExecutable: string): string | undefined {
  const probe = probeGit(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    cwd,
    gitExecutable,
  );

  if (probe.exitCode === 0) {
    return firstNonEmptyLine(probe.stdout);
  }

  // `--quiet` mutes stderr on "no such ref" — that's the only failure mode we silently skip.
  if (probe.exitCode === 1 && probe.stderr.trim() === "") {
    return undefined;
  }

  throw new DunkUserError(`\`dunk diff --branch\` failed while probing base \`${ref}\`.`, [
    probe.stderr.trim() || `git rev-parse exited with code ${probe.exitCode}.`,
  ]);
}

/** Return the first fallback candidate whose ref exists in the repository. */
function pickFirstResolvableGitRef(
  candidates: readonly string[],
  cwd: string,
  gitExecutable: string,
) {
  for (const candidate of candidates) {
    if (probeGitRefExists(candidate, cwd, gitExecutable)) {
      return candidate;
    }
  }

  return undefined;
}

/** Resolve `git symbolic-ref refs/remotes/origin/HEAD` into the branch name it points at. */
function resolveOriginHead(cwd: string, gitExecutable: string): string | undefined {
  const probe = probeGit(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    cwd,
    gitExecutable,
  );

  if (probe.exitCode !== 0) {
    return undefined;
  }

  const target = firstNonEmptyLine(probe.stdout);
  if (!target) {
    return undefined;
  }

  // `git symbolic-ref` returns e.g. `refs/remotes/origin/main`. Strip the `refs/remotes/` prefix
  // so the user-facing base name reads like the branch they'd type by hand.
  return target.startsWith("refs/remotes/") ? target.slice("refs/remotes/".length) : target;
}

/**
 * Compute the merge-base SHA for `<base>..HEAD`.
 *
 * - `{ kind: "ok", sha }` — common ancestor found.
 * - `{ kind: "no-ancestor" }` — ref resolves but shares no history with HEAD (exit 1 / empty
 *   stderr, per `git merge-base` docs).
 * - `{ kind: "missing-ref" }` — Git reports the ref doesn't exist.
 * - Throws — any other failure mode (corrupt repo, signal kill, etc.).
 */
type MergeBaseResult =
  | { kind: "ok"; sha: string }
  | { kind: "no-ancestor" }
  | { kind: "missing-ref" };

function computeGitMergeBase(base: string, cwd: string, gitExecutable: string): MergeBaseResult {
  const probe = probeGit(["merge-base", base, "HEAD"], cwd, gitExecutable);

  if (probe.exitCode === 0) {
    const sha = firstNonEmptyLine(probe.stdout);
    return sha ? { kind: "ok", sha } : { kind: "no-ancestor" };
  }

  // `git merge-base` exits 1 with empty stderr when refs are valid but share no history.
  if (probe.exitCode === 1 && probe.stderr.trim() === "") {
    return { kind: "no-ancestor" };
  }

  // Treat any stderr that looks like an unknown-revision message as "ref missing" so we can
  // surface a precise error to the user; bubble up anything else (corrupt repo, etc.).
  const stderr = probe.stderr;
  if (
    stderr.includes("Not a valid object name") ||
    stderr.includes("unknown revision") ||
    stderr.includes("bad revision")
  ) {
    return { kind: "missing-ref" };
  }

  throw new DunkUserError(
    `\`dunk diff --branch\` failed while resolving the merge-base for \`${base}\`.`,
    [stderr.trim() || `git merge-base exited with code ${probe.exitCode}.`],
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

/** Resolve a named base into its merge-base SHA, mapping each result type to a clear error. */
function resolveExplicitGitBase(
  base: string,
  cwd: string,
  gitExecutable: string,
): ResolvedBranchBase {
  const result = computeGitMergeBase(base, cwd, gitExecutable);

  switch (result.kind) {
    case "ok":
      return { displayBase: base, gitMergeBaseSha: result.sha };
    case "missing-ref":
      throw createBaseNotFoundError(base);
    case "no-ancestor":
      throw createMissingMergeBaseError(base);
  }
}

/** Resolve a Git branch-review base into a concrete merge-base SHA. */
export function resolveGitBranchBase(
  input: VcsCommandInput,
  { cwd = process.cwd(), gitExecutable = "git" }: { cwd?: string; gitExecutable?: string } = {},
): ResolvedBranchBase {
  const explicitBase = input.branchReview?.explicitBase;
  if (explicitBase) {
    return resolveExplicitGitBase(explicitBase, cwd, gitExecutable);
  }

  const configuredBase = input.options.branchReviewBase;
  if (configuredBase) {
    return resolveExplicitGitBase(configuredBase, cwd, gitExecutable);
  }

  const originHead = resolveOriginHead(cwd, gitExecutable);
  const candidates = originHead
    ? [originHead, ...GIT_BASE_FALLBACK_REFS.filter((ref) => ref !== originHead)]
    : [...GIT_BASE_FALLBACK_REFS];

  const detected = pickFirstResolvableGitRef(candidates, cwd, gitExecutable);
  if (!detected) {
    throw createNoBaseFoundError();
  }

  return resolveExplicitGitBase(detected, cwd, gitExecutable);
}
