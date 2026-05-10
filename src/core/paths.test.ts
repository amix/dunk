import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  resolveBundledDunkReviewSkillPath,
  resolveGlobalConfigPath,
  resolveDunkStatePath,
} from "./paths";

function createTempRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("paths", () => {
  test("resolves XDG config and state paths", () => {
    const env = { XDG_CONFIG_HOME: join("/tmp", "xdg-home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(join("/tmp", "xdg-home", "dunk", "config.toml"));
    expect(resolveDunkStatePath(env)).toBe(join("/tmp", "xdg-home", "dunk", "state.json"));
  });

  test("falls back to HOME for config and state paths", () => {
    const env = { HOME: join("/tmp", "home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(
      join("/tmp", "home", ".config", "dunk", "config.toml"),
    );
    expect(resolveDunkStatePath(env)).toBe(join("/tmp", "home", ".config", "dunk", "state.json"));
  });

  test("locates the bundled dunk review skill from source", () => {
    const resolvedPath = resolveBundledDunkReviewSkillPath([import.meta.dir]);

    expect(resolvedPath).toEndWith(join("skills", "dunk-review", "SKILL.md"));
  });

  test("locates the bundled dunk review skill through a nested dunk package", () => {
    const tempRoot = createTempRoot("hunk-skill-path-");

    try {
      const nestedPackageRoot = join(tempRoot, "node_modules", "dunk");
      const skillPath = join(nestedPackageRoot, "skills", "dunk-review", "SKILL.md");
      const fakeBinary = join(tempRoot, "node_modules", "dunk-linux-x64", "bin", "dunk");

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
