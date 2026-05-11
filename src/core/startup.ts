import type { resolveConfiguredCliInput } from "./config";
import { DunkUserError } from "./errors";
import type { loadAppBootstrap } from "./loaders";
import type { looksLikePatchInput } from "./pager";
import type {
  openControllingTerminal,
  resolveRuntimeCliInput,
  usesPipedPatchInput,
  ControllingTerminal,
} from "./terminal";
import type { AppBootstrap, CliInput, ParsedCliInput } from "./types";
import { parseCli } from "./cli";

export type StartupPlan =
  | {
      kind: "help";
      text: string;
    }
  | {
      kind: "plain-text-pager";
      text: string;
    }
  | {
      kind: "app";
      bootstrap: AppBootstrap;
      cliInput: CliInput;
      controllingTerminal: ControllingTerminal | null;
    };

export interface StartupDeps {
  parseCliImpl?: (argv: string[]) => Promise<ParsedCliInput>;
  readStdinText?: () => Promise<string>;
  looksLikePatchInputImpl?: typeof looksLikePatchInput;
  resolveRuntimeCliInputImpl?: typeof resolveRuntimeCliInput;
  resolveConfiguredCliInputImpl?: typeof resolveConfiguredCliInput;
  loadAppBootstrapImpl?: typeof loadAppBootstrap;
  usesPipedPatchInputImpl?: typeof usesPipedPatchInput;
  openControllingTerminalImpl?: typeof openControllingTerminal;
}

/**
 * Normalize startup work so help, pager, and app-bootstrap paths can be tested
 * directly. The heavy diff/render modules — `loaders.ts` (Pierre), `pager.ts`,
 * `terminal.ts`, `watch.ts`, `config.ts` — are dynamic-imported behind the
 * branches that actually need them, so `--help`, `--version`, and the agent
 * `dunk comments` CLI pay zero parse-time cost for Pierre and friends.
 */
export async function prepareStartupPlan(
  argv: string[] = process.argv,
  deps: StartupDeps = {},
): Promise<StartupPlan> {
  const parseCliImpl = deps.parseCliImpl ?? parseCli;
  let parsedCliInput = await parseCliImpl(argv);

  if (parsedCliInput.kind === "help") {
    return {
      kind: "help",
      text: parsedCliInput.text,
    };
  }

  if (parsedCliInput.kind === "pager") {
    const readStdinText = deps.readStdinText ?? (() => new Response(Bun.stdin.stream()).text());
    const looksLikePatchInputImpl =
      deps.looksLikePatchInputImpl ?? (await import("./pager")).looksLikePatchInput;

    const stdinText = await readStdinText();

    if (!looksLikePatchInputImpl(stdinText)) {
      return {
        kind: "plain-text-pager",
        text: stdinText,
      };
    }

    parsedCliInput = {
      kind: "patch",
      file: "-",
      text: stdinText,
      options: {
        ...parsedCliInput.options,
        pager: true,
      },
    };
  }

  // From here we're committed to launching the TUI — load the heavy modules
  // lazily so the cold-help path never had to pay for them.
  const [terminalMod, configMod, loadersMod, watchMod] = await Promise.all([
    import("./terminal"),
    import("./config"),
    import("./loaders"),
    import("./watch"),
  ]);

  const resolveRuntimeCliInputImpl =
    deps.resolveRuntimeCliInputImpl ?? terminalMod.resolveRuntimeCliInput;
  const resolveConfiguredCliInputImpl =
    deps.resolveConfiguredCliInputImpl ?? configMod.resolveConfiguredCliInput;
  const loadAppBootstrapImpl = deps.loadAppBootstrapImpl ?? loadersMod.loadAppBootstrap;
  const usesPipedPatchInputImpl = deps.usesPipedPatchInputImpl ?? terminalMod.usesPipedPatchInput;
  const openControllingTerminalImpl =
    deps.openControllingTerminalImpl ?? terminalMod.openControllingTerminal;

  const runtimeCliInput = resolveRuntimeCliInputImpl(parsedCliInput);
  const configured = resolveConfiguredCliInputImpl(runtimeCliInput);
  const cliInput = configured.input;

  if (cliInput.options.watch && !watchMod.canReloadInput(cliInput)) {
    throw new DunkUserError(
      "`--watch` requires a file- or Git-backed input that dunk can reopen.",
      [
        "Use a patch file path instead of stdin, and avoid `--agent-context -` for watched sessions.",
      ],
    );
  }

  const bootstrap = await loadAppBootstrapImpl(cliInput);
  const controllingTerminal = usesPipedPatchInputImpl(cliInput)
    ? openControllingTerminalImpl()
    : null;

  return {
    kind: "app",
    bootstrap,
    cliInput,
    controllingTerminal,
  };
}
