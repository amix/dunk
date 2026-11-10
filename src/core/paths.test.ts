import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveBundledDunkReviewSkillPath, resolveGlobalConfigPath } from "./paths";

function createTempRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("paths", () => {
  test("resolves the XDG config path", () => {
    const env = { XDG_CONFIG_HOME: join("/tmp", "xdg-home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(join("/tmp", "xdg-home", "dunk", "config.toml"));
  });

  test("falls back to HOME for the config path", () => {
    const env = { HOME: join("/tmp", "home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(
      join("/tmp", "home", ".config", "dunk", "config.toml"),
    );
  });

  test("locates the bundled dunk review skill from source", () => {
    const resolvedPath = resolveBundledDunkReviewSkillPath([import.meta.dir]);

    expect(resolvedPath).toEndWith(join("skills", "dunk-review", "SKILL.md"));
  });

  test("locates the bundled skill from a sibling dunkdiff package in flat node_modules", () => {
    const tempRoot = createTempRoot("dunk-skill-path-");

    try {
      const nestedPackageRoot = join(tempRoot, "node_modules", "dunkdiff");
      const skillPath = join(nestedPackageRoot, "skills", "dunk-review", "SKILL.md");
      const fakeBinary = join(tempRoot, "node_modules", "dunkdiff-linux-x64", "bin", "dunk");

      mkdirSync(dirname(skillPath), { recursive: true });
      mkdirSync(dirname(fakeBinary), { recursive: true });
      writeFileSync(skillPath, "# skill\n");
      writeFileSync(fakeBinary, "binary\n");

      expect(resolveBundledDunkReviewSkillPath([fakeBinary])).toBe(skillPath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
