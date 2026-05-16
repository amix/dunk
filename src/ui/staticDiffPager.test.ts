import { describe, expect, test } from "bun:test";
import type { AppBootstrap, CliInput, DiffFile } from "../core/types";
import { createTestDiffFile, createTestAnnotations } from "../../test/helpers/diff-helpers";
import { renderStaticDiffPager, staticStackPalette } from "./staticDiffPager";
import { resolveTheme, THEMES } from "./themes";

const PATCH_INPUT: CliInput = { kind: "patch", file: "-", options: {} };

function ansiBg(hex: string) {
  const value = hex.replace(/^#/, "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
}

function bootstrapFor(files: DiffFile[], overrides: Partial<AppBootstrap> = {}): AppBootstrap {
  return {
    input: PATCH_INPUT,
    changeset: { id: "test", sourceLabel: "test", title: "test", files },
    initialMode: "stack",
    initialTheme: "graphite",
    ...overrides,
  };
}

describe("renderStaticDiffPager", () => {
  test("renders the file path, both diff sides, and the hunk header", () => {
    const file = createTestDiffFile({ context: 1 });
    const output = renderStaticDiffPager(bootstrapFor([file]));

    expect(output).toContain("example.ts");
    expect(output).toContain("@@");
    expect(output).toContain("alpha = 10"); // added side
    expect(output).toContain("alpha = 1;"); // removed side
  });

  test("colors come from the resolved theme, not hardcoded values", () => {
    const file = createTestDiffFile({ context: 0 });
    const output = renderStaticDiffPager(bootstrapFor([file]));
    const theme = resolveTheme("graphite", null);

    // An added line must carry the theme's addition background, proving the
    // static mapping reads the same AppTheme fields as the interactive
    // renderer's stackCellPalette rather than inventing its own palette.
    expect(output).toContain(ansiBg(theme.addedBg));
    expect(output).toContain(ansiBg(theme.removedBg));
  });

  test("omits hunk headers when disabled", () => {
    const file = createTestDiffFile({ context: 0 });
    const withHeaders = renderStaticDiffPager(bootstrapFor([file]));
    const withoutHeaders = renderStaticDiffPager(
      bootstrapFor([file], { initialShowHunkHeaders: false }),
    );

    expect(withHeaders).toContain("@@");
    expect(withoutHeaders).not.toContain("@@");
  });

  test("never renders the comment overlay (pager content is transient)", () => {
    const file = createTestDiffFile({ annotations: createTestAnnotations("example.ts") });
    const output = renderStaticDiffPager(bootstrapFor([file]));

    expect(file.annotations.length).toBeGreaterThan(0);
    expect(output).not.toContain("Annotation for example.ts");
  });

  test("renders an empty changeset without throwing", () => {
    expect(renderStaticDiffPager(bootstrapFor([]))).toBe("\n");
  });

  // Enforces the "mirrors stackCellPalette" invariant as a test, not just a
  // comment: the static palette must select the exact AppTheme fields the
  // interactive renderer uses, for every built-in theme.
  test("the static palette reads the same theme fields across all built-in themes", () => {
    for (const theme of THEMES) {
      expect(staticStackPalette("addition", theme)).toEqual({
        contentBg: theme.addedBg,
        signColor: theme.addedSignColor,
      });
      expect(staticStackPalette("deletion", theme)).toEqual({
        contentBg: theme.removedBg,
        signColor: theme.removedSignColor,
      });
      expect(staticStackPalette("context", theme)).toEqual({
        contentBg: theme.contextBg,
        signColor: theme.muted,
      });
    }
  });

  // The ANSI serializer only colors strict 6-hex values; a theme using
  // shorthand/8-digit would silently render colorless. Pin every consumed
  // field across all built-in themes.
  test("every theme color the static pager consumes is a 6-digit hex value", () => {
    const sixHex = /^#[0-9a-f]{6}$/i;
    for (const theme of THEMES) {
      for (const field of [
        theme.addedBg,
        theme.removedBg,
        theme.contextBg,
        theme.addedSignColor,
        theme.removedSignColor,
        theme.muted,
        theme.lineNumberFg,
        theme.lineNumberBg,
        theme.badgeNeutral,
        theme.panelAlt,
        theme.text,
      ]) {
        expect(field).toMatch(sixHex);
      }
    }
  });
});
