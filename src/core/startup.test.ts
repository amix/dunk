import { describe, expect, test } from "bun:test";
import { DunkUserError } from "./errors";
import { prepareStartupPlan } from "./startup";
import type { AppBootstrap, CliInput, ParsedCliInput } from "./types";

function createBootstrap(input: CliInput): AppBootstrap {
  return {
    input,
    changeset: {
      id: "changeset:startup",
      sourceLabel: "repo",
      title: "repo working tree",
      files: [],
    },
    initialMode: input.options.mode ?? "auto",
  };
}

describe("startup planning", () => {
  test("returns help output without entering app startup", async () => {
    let loaded = false;

    const plan = await prepareStartupPlan(["bun", "dunk"], {
      parseCliImpl: async () => ({ kind: "help", text: "Usage: hunk\n" }),
      loadAppBootstrapImpl: async () => {
        loaded = true;
        throw new Error("unreachable");
      },
    });

    expect(plan).toEqual({ kind: "help", text: "Usage: hunk\n" });
    expect(loaded).toBe(false);
  });

  test("routes non-diff pager stdin to the plain-text pager path", async () => {
    let loaded = false;

    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: { theme: "paper" } }),
      readStdinText: async () => "* main\n  feature/demo\n",
      looksLikePatchInputImpl: () => false,
      loadAppBootstrapImpl: async () => {
        loaded = true;
        throw new Error("unreachable");
      },
    });

    expect(plan).toEqual({ kind: "plain-text-pager", text: "* main\n  feature/demo\n" });
    expect(loaded).toBe(false);
  });

  test("normalizes diff-like pager stdin into patch app startup", async () => {
    const seenInputs: CliInput[] = [];

    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: { theme: "paper" } }),
      readStdinText: async () => "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      looksLikePatchInputImpl: () => true,
      // The interactive TUI path requires a usable TTY and a non-captured,
      // non-dumb terminal; without these the pager now falls back instead.
      stdoutIsTTY: true,
      env: { TERM: "xterm-256color" },
      resolveRuntimeCliInputImpl(input) {
        seenInputs.push(input);
        return input;
      },
      resolveConfiguredCliInputImpl(input) {
        seenInputs.push(input);
        return { input } as never;
      },
      loadAppBootstrapImpl: async (input) => {
        seenInputs.push(input);
        return createBootstrap(input);
      },
      usesPipedPatchInputImpl: () => false,
    });

    expect(plan.kind).toBe("app");
    if (plan.kind !== "app") {
      throw new Error("Expected app startup plan.");
    }

    expect(plan.cliInput).toMatchObject({
      kind: "patch",
      file: "-",
      text: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      options: {
        theme: "paper",
        pager: true,
      },
    });
    expect(seenInputs).toHaveLength(3);
  });

  test("renders a static diff for a captured pager host", async () => {
    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: {} }),
      readStdinText: async () => "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      looksLikePatchInputImpl: () => true,
      // LazyGit-style: TERM=dumb + GIT_PAGER, stdout is a non-TTY pipe. This
      // must beat the generic non-TTY passthrough below.
      stdoutIsTTY: false,
      env: { TERM: "dumb", GIT_PAGER: "dunk" },
      resolveRuntimeCliInputImpl: (input) => input,
      resolveConfiguredCliInputImpl: (input) => ({ input }) as never,
      loadAppBootstrapImpl: async (input) => createBootstrap(input),
    });

    expect(plan.kind).toBe("static-diff-pager");
    if (plan.kind !== "static-diff-pager") {
      throw new Error("Expected static-diff-pager plan.");
    }
    expect(plan.bootstrap.input).toMatchObject({ kind: "patch", file: "-" });
  });

  test.each([
    { name: "LAZYGIT marker", env: { TERM: "dumb", LAZYGIT_STATE: "1" } },
    { name: "GIT_PAGER", env: { TERM: "dumb", GIT_PAGER: "dunk" } },
    { name: "lv filter mode", env: { TERM: "dumb", LV: "-c" } },
  ])("captured-host detection fires for $name", async ({ env }) => {
    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: {} }),
      readStdinText: async () => "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      looksLikePatchInputImpl: () => true,
      stdoutIsTTY: false,
      env,
      resolveRuntimeCliInputImpl: (input) => input,
      resolveConfiguredCliInputImpl: (input) => ({ input }) as never,
      loadAppBootstrapImpl: async (input) => createBootstrap(input),
    });

    expect(plan.kind).toBe("static-diff-pager");
  });

  test("GIT_PAGER without TERM=dumb is not a captured host (no false positive)", async () => {
    // A globally-exported GIT_PAGER must not force static output for a normal
    // pager pipe; the TERM=dumb gate keeps interactive use on the TUI path.
    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: {} }),
      readStdinText: async () => "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      looksLikePatchInputImpl: () => true,
      stdoutIsTTY: false,
      env: { TERM: "xterm-256color", GIT_PAGER: "dunk" },
      loadAppBootstrapImpl: async () => {
        throw new Error("should not bootstrap");
      },
    });

    expect(plan.kind).toBe("passthrough");
  });

  test("echoes the raw patch when there is no usable TTY and no captured host", async () => {
    const stdinText = "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    let bootstrapped = false;

    const plan = await prepareStartupPlan(["bun", "dunk", "pager"], {
      parseCliImpl: async () => ({ kind: "pager", options: {} }),
      readStdinText: async () => stdinText,
      looksLikePatchInputImpl: () => true,
      stdoutIsTTY: false,
      env: { TERM: "xterm-256color" },
      loadAppBootstrapImpl: async () => {
        bootstrapped = true;
        throw new Error("should not bootstrap for passthrough");
      },
    });

    expect(plan).toEqual({ kind: "passthrough", text: stdinText });
    expect(bootstrapped).toBe(false);
  });

  test("rejects watch mode for stdin-backed patch inputs", async () => {
    const cliInput: CliInput = {
      kind: "patch",
      file: "-",
      options: {
        watch: true,
      },
    };

    await expect(
      prepareStartupPlan(["bun", "dunk", "patch", "-", "--watch"], {
        parseCliImpl: async () => cliInput as ParsedCliInput,
        resolveRuntimeCliInputImpl: (input) => input,
        resolveConfiguredCliInputImpl: (input) => ({ input }) as never,
      }),
    ).rejects.toBeInstanceOf(DunkUserError);
  });

  test("opens the controlling terminal for piped patch startup", async () => {
    const cliInput: CliInput = {
      kind: "patch",
      file: "-",
      options: {
        mode: "auto",
        pager: true,
      },
    };
    const controllingTerminal = { stdin: {} as never, stdout: {} as never, close: () => {} };
    let opened = 0;

    const plan = await prepareStartupPlan(["bun", "dunk", "patch", "-"], {
      parseCliImpl: async () => cliInput as ParsedCliInput,
      resolveRuntimeCliInputImpl: (input) => input,
      resolveConfiguredCliInputImpl: (input) => ({ input }) as never,
      loadAppBootstrapImpl: async (input) => createBootstrap(input),
      usesPipedPatchInputImpl: (input) => {
        expect(input).toBe(cliInput);
        return true;
      },
      openControllingTerminalImpl: () => {
        opened += 1;
        return controllingTerminal;
      },
    });

    expect(plan).toMatchObject({
      kind: "app",
      cliInput,
      controllingTerminal,
    });
    expect(opened).toBe(1);
  });
});
