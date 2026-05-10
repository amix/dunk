import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

const DUNK_REVIEW_SKILL_RELATIVE_PATH = join("skills", "dunk-review", "SKILL.md");

/** Resolve the base config directory Hunk should use for user-scoped files. */
export function resolveUserConfigDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.XDG_CONFIG_HOME) {
    return env.XDG_CONFIG_HOME;
  }

  if (env.HOME) {
    return join(env.HOME, ".config");
  }

  return undefined;
}

/** Resolve the global Hunk config file path from the current environment. */
export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env) {
  const configDir = resolveUserConfigDir(env);
  return configDir ? join(configDir, "hunk", "config.toml") : undefined;
}

/** Resolve the persisted Hunk state file path from the current environment. */
export function resolveHunkStatePath(env: NodeJS.ProcessEnv = process.env) {
  const configDir = resolveUserConfigDir(env);
  return configDir ? join(configDir, "hunk", "state.json") : undefined;
}

/** Search one path and its parents for one relative child path. */
function findRelativePathFromAncestors(startPath: string, relativePath: string) {
  let current = resolve(startPath);

  try {
    if (fs.statSync(current).isFile()) {
      current = dirname(current);
    }
  } catch {
    // Treat non-existent paths as directories so ancestor walking still works in tests.
  }

  for (;;) {
    const candidate = join(current, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

/** Resolve the bundled dunk review skill path from source, npm, or prebuilt package layouts. */
export function resolveBundledDunkReviewSkillPath(searchRoots?: string[]) {
  const roots = searchRoots ?? [import.meta.dir, process.execPath];
  const relativeCandidates = [
    DUNK_REVIEW_SKILL_RELATIVE_PATH,
    join("hunkdiff", DUNK_REVIEW_SKILL_RELATIVE_PATH),
    join("node_modules", "hunkdiff", DUNK_REVIEW_SKILL_RELATIVE_PATH),
  ];

  for (const root of roots) {
    for (const relativePath of relativeCandidates) {
      const resolvedPath = findRelativePathFromAncestors(root, relativePath);
      if (resolvedPath) {
        return resolvedPath;
      }
    }
  }

  throw new Error("Could not locate the bundled dunk review skill.");
}
