import { describe, expect, test } from "bun:test";
import { resolveEditorLaunch } from "./editor";

describe("editor launch resolution", () => {
  test("returns null when neither $VISUAL nor $EDITOR is set", () => {
    expect(resolveEditorLaunch("a.ts", 1, {})).toBeNull();
    expect(resolveEditorLaunch("a.ts", 1, { editor: "  " })).toBeNull();
  });

  test("$VISUAL beats $EDITOR when both are set", () => {
    expect(resolveEditorLaunch("a.ts", 5, { visual: "nvim", editor: "vim" })).toMatchObject({
      command: ["nvim", "+5", "a.ts"],
      needsTty: true,
    });
  });

  test("vim/nvim/vi/nano take +LINE file and inherit the TTY", () => {
    for (const editor of ["vim", "nvim", "vi", "nano"]) {
      const plan = resolveEditorLaunch("src/foo.ts", 12, { editor });
      expect(plan).toMatchObject({
        command: [editor, "+12", "src/foo.ts"],
        needsTty: true,
      });
    }
  });

  test("VS Code and forks use --goto file:LINE without taking the TTY", () => {
    for (const editor of ["code", "code-insiders", "cursor", "windsurf"]) {
      const plan = resolveEditorLaunch("src/foo.ts", 7, { editor });
      expect(plan).toMatchObject({
        command: [editor, "--goto", "src/foo.ts:7"],
        needsTty: false,
      });
    }
  });

  test("zed and sublime get the file:LINE shape; zed runs detached, helix takes the TTY", () => {
    expect(resolveEditorLaunch("src/foo.ts", 3, { editor: "zed" })).toMatchObject({
      command: ["zed", "src/foo.ts:3"],
      needsTty: false,
    });
    expect(resolveEditorLaunch("src/foo.ts", 3, { editor: "subl" })).toMatchObject({
      command: ["subl", "src/foo.ts:3"],
      needsTty: false,
    });
    expect(resolveEditorLaunch("src/foo.ts", 3, { editor: "hx" })).toMatchObject({
      command: ["hx", "src/foo.ts:3"],
      needsTty: true,
    });
  });

  test("preserves additional flags from $EDITOR", () => {
    expect(resolveEditorLaunch("a.ts", 9, { editor: "nvim --headless" })).toMatchObject({
      command: ["nvim", "--headless", "+9", "a.ts"],
    });
  });

  test("dispatches by basename so absolute paths still match the editor convention", () => {
    expect(resolveEditorLaunch("a.ts", 4, { editor: "/opt/homebrew/bin/cursor" })).toMatchObject({
      command: ["/opt/homebrew/bin/cursor", "--goto", "a.ts:4"],
      needsTty: false,
    });
  });

  test("unknown editors fall back to +LINE and take the TTY", () => {
    expect(resolveEditorLaunch("a.ts", 11, { editor: "kakoune" })).toMatchObject({
      command: ["kakoune", "+11", "a.ts"],
      needsTty: true,
    });
  });
});
