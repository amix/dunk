import { existsSync, statSync } from "node:fs";
import { Command, Option } from "commander";
import type {
  CommonOptions,
  HelpCommandInput,
  LayoutMode,
  PagerCommandInput,
  ParsedCliInput,
} from "./types";
import {
  renderCommentsHelp,
  runCommentsList,
  runCommentsResolve,
  runCommentsShow,
} from "./cliComments";
import { DunkUserError } from "./errors";
import { resolveBundledDunkReviewSkillPath } from "./paths";
import { resolveCliVersion } from "./version";

/** Validate one requested layout mode from CLI input. */
function parseLayoutMode(value: string): LayoutMode {
  if (value === "auto" || value === "split" || value === "stack") {
    return value;
  }

  throw new Error(`Invalid layout mode: ${value}`);
}

/** Read one paired positive/negative boolean flag directly from raw argv. */
function resolveBooleanFlag(argv: string[], enabledFlag: string, disabledFlag: string) {
  let resolved: boolean | undefined;

  for (const arg of argv) {
    if (arg === enabledFlag) {
      resolved = true;
      continue;
    }

    if (arg === disabledFlag) {
      resolved = false;
    }
  }

  return resolved;
}

/** Normalize the flags shared by every input mode. */
function buildCommonOptions(
  options: {
    mode?: LayoutMode;
    theme?: string;
    pager?: boolean;
    watch?: boolean;
  },
  argv: string[],
): CommonOptions {
  return {
    mode: options.mode,
    theme: options.theme,
    pager: options.pager ? true : undefined,
    watch: options.watch ? true : undefined,
    excludeUntracked: resolveBooleanFlag(argv, "--exclude-untracked", "--no-exclude-untracked"),
    lineNumbers: resolveBooleanFlag(argv, "--line-numbers", "--no-line-numbers"),
    wrapLines: resolveBooleanFlag(argv, "--wrap", "--no-wrap"),
    hunkHeaders: resolveBooleanFlag(argv, "--hunk-headers", "--no-hunk-headers"),
    comments: resolveBooleanFlag(argv, "--comments", "--no-comments"),
  };
}

/** Attach the shared view flags to a subcommand parser. */
function applyCommonOptions(command: Command) {
  return command
    .option("--mode <mode>", "layout mode: auto, split, stack", parseLayoutMode)
    .option("--theme <theme>", "named theme override")
    .option("--pager", "use pager-style chrome and controls")
    .option("--line-numbers", "show line numbers")
    .option("--no-line-numbers", "hide line numbers")
    .option("--wrap", "wrap long diff lines")
    .option("--no-wrap", "truncate long diff lines to one row")
    .option("--hunk-headers", "show hunk metadata rows")
    .option("--no-hunk-headers", "hide hunk metadata rows")
    .option("--comments", "show user comments by default")
    .option("--no-comments", "hide user comments by default");
}

/** Attach auto-refresh support to review commands that can reopen their source input. */
function applyWatchOption(command: Command) {
  return command.option("--watch", "auto-reload when the current diff input changes");
}

/** Render plain-text version output for `dunk --version`. */
function renderCliVersion() {
  return `${resolveCliVersion()}\n`;
}

/** Render the bundled dunk review skill path for shell usage. */
function renderDunkReviewSkillPath() {
  return `${resolveBundledDunkReviewSkillPath()}\n`;
}

/** Build the `dunk skill` help text. */
function renderSkillHelp() {
  return [
    "Usage: dunk skill path",
    "",
    "Print the bundled dunk review skill path.",
    "Load or symlink that file in your coding agent to keep it in sync across dunk upgrades.",
    "",
  ].join("\n");
}

/** Build the top-level help text shown by bare `dunk` and `dunk --help`. */
function renderCliHelp() {
  return [
    "Usage: dunk <command> [options]",
    "",
    "Review diffs in a TUI, leave inline comments, and let a coding agent resolve them through .dunk/comments.json.",
    "",
    "Commands:",
    "  dunk diff [target] [-- <pathspec...>]   review working tree changes or compare against a target",
    "  dunk diff --staged [-- <pathspec...>]   review staged changes",
    "  dunk diff <left> <right>                compare two concrete files",
    "  dunk show [target] [-- <pathspec...>]   review the last commit or a given target",
    "  dunk stash show [ref]                   review a stash entry (git only)",
    "  dunk patch [file]                       review a patch file or stdin",
    "  dunk pager                              general Git pager wrapper with diff detection",
    "  dunk difftool <left> <right> [path]     review Git difftool file pairs",
    "  dunk comments [list|show|resolve]       inspect or resolve review comments without the TUI",
    "  dunk skill path                         print the bundled dunk review skill path",
    "",
    "Global options:",
    "  -h, --help                              show help",
    "  -v, --version                           show version",
    "",
    "Common review options:",
    "  --mode <mode>                           layout mode: auto, split, stack",
    "  --watch                                 auto-reload when the current diff input changes",
    "  --pager                                 use pager-style chrome and controls",
    "  --line-numbers / --no-line-numbers      show or hide line numbers",
    "  --wrap / --no-wrap                      wrap or truncate long diff lines",
    "  --hunk-headers / --no-hunk-headers      show or hide hunk metadata rows",
    "  --comments / --no-comments              show or hide user comments by default",
    "  --theme <theme>                         named theme override",
    "",
    "Git diff options:",
    "  --staged, --cached                      review staged changes",
    "  --exclude-untracked                     hide untracked files in working tree reviews",
    "",
    "Notes:",
    "  Run `dunk <command> --help` for command-specific syntax and options.",
    '  "target" refers to a generic set of changes; it can be a ref (git) or revset (jj)',
    "",
  ].join("\n");
}

/** Split raw arguments into command tokens and optional pathspecs after `--`. */
function splitPathspecArgs(tokens: string[]) {
  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex === -1) {
    return { commandTokens: tokens, pathspecs: [] as string[] };
  }

  return {
    commandTokens: tokens.slice(0, separatorIndex),
    pathspecs: tokens.slice(separatorIndex + 1),
  };
}

/** Return whether both diff operands are concrete files on disk. */
function areExistingFiles(left: string, right: string) {
  return [left, right].every((path) => existsSync(path) && statSync(path).isFile());
}

/** Parse one standalone command while letting us capture `--help` as plain text. */
async function parseStandaloneCommand(command: Command, tokens: string[]) {
  command.exitOverride();

  try {
    await command.parseAsync(["bun", "dunk", ...tokens]);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "commander.helpDisplayed"
    ) {
      return;
    }

    throw error;
  }
}

/** Build one command parser with the shared dunk options attached. */
function createCommand(name: string, description: string) {
  return applyCommonOptions(new Command(name).description(description));
}

/** Parse the overloaded `dunk diff` command. */
async function parseDiffCommand(tokens: string[], _argv: string[]): Promise<ParsedCliInput> {
  const { commandTokens, pathspecs } = splitPathspecArgs(tokens);
  const command = applyWatchOption(
    createCommand("diff", "review diffs or compare two concrete files"),
  )
    .option("--staged", "show staged changes instead of the working tree")
    .option("--cached", "alias for --staged")
    .option("--exclude-untracked", "exclude untracked files from working tree reviews")
    .addOption(
      new Option(
        "--no-exclude-untracked",
        "include untracked files in working tree reviews",
      ).hideHelp(),
    )
    .argument("[targets...]");

  let parsedTargets: string[] = [];
  let parsedOptions: Record<string, unknown> = {};

  command.action((targets: string[], options: Record<string, unknown>) => {
    parsedTargets = targets;
    parsedOptions = options;
  });

  if (commandTokens.includes("--help") || commandTokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, commandTokens);

  const staged = Boolean(parsedOptions.staged) || Boolean(parsedOptions.cached);
  // Scan the command tokens (already stripped of post-`--` pathspecs) so a
  // pathspec literally named e.g. `--no-wrap` does not flip a view option.
  const options = buildCommonOptions(parsedOptions, commandTokens);
  const normalizedPathspecs = pathspecs.length > 0 ? pathspecs : undefined;

  if (parsedTargets.length === 0) {
    return {
      kind: "vcs",
      staged,
      pathspecs: normalizedPathspecs,
      options,
    };
  }

  if (parsedTargets.length === 1) {
    return {
      kind: "vcs",
      range: parsedTargets[0],
      staged,
      pathspecs: normalizedPathspecs,
      options,
    };
  }

  if (!staged && !normalizedPathspecs) {
    if (parsedTargets.length === 2 && areExistingFiles(parsedTargets[0]!, parsedTargets[1]!)) {
      return {
        kind: "diff",
        left: parsedTargets[0]!,
        right: parsedTargets[1]!,
        options,
      };
    }

    return {
      kind: "vcs",
      range: parsedTargets[0]!,
      staged,
      pathspecs: parsedTargets.slice(1),
      options,
    };
  }

  throw new Error(
    "Use `dunk diff [target] [-- pathspec...]`, `dunk diff <left> <right>` for file comparison.",
  );
}

/** Parse the Git-style `dunk show` command. */
async function parseShowCommand(tokens: string[], _argv: string[]): Promise<ParsedCliInput> {
  const { commandTokens, pathspecs } = splitPathspecArgs(tokens);
  const command = applyWatchOption(
    createCommand("show", "review the last commit or a given ref"),
  ).argument("[ref]");

  let parsedRef: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((ref: string | undefined, options: Record<string, unknown>) => {
    parsedRef = ref;
    parsedOptions = options;
  });

  if (commandTokens.includes("--help") || commandTokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, commandTokens);

  return {
    kind: "show",
    ref: parsedRef,
    pathspecs: pathspecs.length > 0 ? pathspecs : undefined,
    options: buildCommonOptions(parsedOptions, commandTokens),
  };
}

/** Parse the patch-file / stdin patch entrypoint. */
async function parsePatchCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const command = applyWatchOption(
    createCommand("patch", "review a patch file, or read a patch from stdin"),
  ).argument("[file]");

  let parsedFile: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((file: string | undefined, options: Record<string, unknown>) => {
    parsedFile = file;
    parsedOptions = options;
  });

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "patch",
    file: parsedFile,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse the general pager wrapper command used from Git `core.pager`. */
async function parsePagerCommand(
  tokens: string[],
  argv: string[],
): Promise<PagerCommandInput | HelpCommandInput> {
  const command = createCommand("pager", "general Git pager wrapper with diff detection");
  let parsedOptions: Record<string, unknown> = {};

  command.action((options: Record<string, unknown>) => {
    parsedOptions = options;
  });

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "pager",
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse Git difftool-style two-file review commands. */
async function parseDifftoolCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const command = applyWatchOption(createCommand("difftool", "review Git difftool file pairs"))
    .argument("<left>")
    .argument("<right>")
    .argument("[path]");

  let parsedLeft = "";
  let parsedRight = "";
  let parsedPath: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action(
    (left: string, right: string, path: string | undefined, options: Record<string, unknown>) => {
      parsedLeft = left;
      parsedRight = right;
      parsedPath = path;
      parsedOptions = options;
    },
  );

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "difftool",
    left: parsedLeft,
    right: parsedRight,
    path: parsedPath,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Pull every positional id from `dunk comments resolve` and reject the rest. */
function parseResolveIds(args: string[]): number[] {
  const ids: number[] = [];
  for (const raw of args) {
    if (raw.startsWith("-")) {
      throw new DunkUserError(`\`dunk comments resolve\` takes ids only, got \`${raw}\`.`);
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
      throw new DunkUserError(
        `\`dunk comments resolve\` expects positive integer ids, got \`${raw}\`.`,
      );
    }
    ids.push(parsed);
  }
  return ids;
}

/**
 * Parse `dunk comments ...` and execute the requested action eagerly.
 *
 * Like `dunk skill path`, these are print-and-exit commands rather than TUI
 * sessions, so we build the output here and return it as `kind: "help"` so
 * `main.tsx` writes it to stdout and exits 0. Errors raise `DunkUserError`,
 * which `formatCliError` renders cleanly with exit 1.
 */
async function parseCommentsCommand(tokens: string[]): Promise<HelpCommandInput> {
  const [subcommand, ...rest] = tokens;

  // `--help`/`-h` at any position short-circuits to the subcommand help text.
  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: renderCommentsHelp() };
  }

  if (!subcommand || subcommand === "list") {
    const json = rest.includes("--json");
    const extras = rest.filter((arg) => arg !== "--json");
    if (extras.length > 0) {
      throw new DunkUserError(`Unexpected argument for \`dunk comments list\`: \`${extras[0]}\`.`);
    }

    return { kind: "help", text: runCommentsList(json ? "json" : "text") };
  }

  if (subcommand === "show") {
    const json = rest.includes("--json");
    let contextLines: number | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === "--json") {
        continue;
      }
      if (arg === "--context") {
        const next = rest[i + 1];
        if (next === undefined) {
          throw new DunkUserError("`dunk comments show --context` requires a number.");
        }
        const parsed = Number.parseInt(next, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== next) {
          throw new DunkUserError(
            `\`dunk comments show --context\` expects a non-negative integer, got \`${next}\`.`,
          );
        }
        contextLines = parsed;
        i += 1;
        continue;
      }
      if (arg.startsWith("--context=")) {
        const value = arg.slice("--context=".length);
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
          throw new DunkUserError(
            `\`dunk comments show --context\` expects a non-negative integer, got \`${value}\`.`,
          );
        }
        contextLines = parsed;
        continue;
      }
      positionals.push(arg);
    }

    if (positionals.length === 0) {
      throw new DunkUserError("`dunk comments show` requires a comment id.");
    }
    if (positionals.length > 1) {
      throw new DunkUserError("`dunk comments show` takes exactly one id.");
    }

    const id = Number.parseInt(positionals[0]!, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== positionals[0]) {
      throw new DunkUserError(
        `\`dunk comments show\` expects a positive integer id, got \`${positionals[0]}\`.`,
      );
    }

    return {
      kind: "help",
      text: runCommentsShow(id, json ? "json" : "text", { contextLines }),
    };
  }

  if (subcommand === "resolve") {
    const ids = parseResolveIds(rest);
    return { kind: "help", text: runCommentsResolve(ids) };
  }

  throw new DunkUserError(`Unknown \`dunk comments\` subcommand: \`${subcommand}\`.`, [
    "Use one of: list, show, resolve. Run `dunk comments --help` for details.",
  ]);
}

/** Parse `dunk skill ...` for bundled skill discovery commands. */
async function parseSkillCommand(tokens: string[]): Promise<HelpCommandInput> {
  const [subcommand, ...rest] = tokens;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return {
      kind: "help",
      text: renderSkillHelp(),
    };
  }

  if (subcommand !== "path") {
    throw new Error("Only `dunk skill path` is supported.");
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    return {
      kind: "help",
      text: renderSkillHelp(),
    };
  }

  if (rest.length > 0) {
    throw new Error("`dunk skill path` does not accept additional arguments.");
  }

  return {
    kind: "help",
    text: renderDunkReviewSkillPath(),
  };
}

/** Parse `dunk stash show ...` for stash entry review. */
async function parseStashCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const [subcommand, ...rest] = tokens;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return {
      kind: "help",
      text:
        [
          "Usage: dunk stash show [ref] [options]",
          "",
          "Review a stash entry as a full dunk changeset.",
          "",
          "Examples:",
          "  dunk stash show",
          "  dunk stash show stash@{1}",
        ].join("\n") + "\n",
    };
  }

  if (subcommand !== "show") {
    throw new Error("Only `dunk stash show` is supported.");
  }

  const command = applyWatchOption(
    createCommand("stash show", "review a stash entry as a full dunk changeset"),
  ).argument("[ref]");

  let parsedRef: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((ref: string | undefined, options: Record<string, unknown>) => {
    parsedRef = ref;
    parsedOptions = options;
  });

  if (rest.includes("--help") || rest.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, rest);

  return {
    kind: "stash-show",
    ref: parsedRef,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse CLI arguments into one normalized input shape for the app loader layer. */
export async function parseCli(argv: string[]): Promise<ParsedCliInput> {
  const args = argv.slice(2);
  const [commandName, ...rest] = args;

  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    return { kind: "help", text: renderCliHelp() };
  }

  if (commandName === "--version" || commandName === "-v" || commandName === "version") {
    return { kind: "help", text: renderCliVersion() };
  }

  switch (commandName) {
    case "diff":
      return parseDiffCommand(rest, argv);
    case "show":
      return parseShowCommand(rest, argv);
    case "patch":
      return parsePatchCommand(rest, argv);
    case "pager":
      return parsePagerCommand(rest, argv);
    case "difftool":
      return parseDifftoolCommand(rest, argv);
    case "stash":
      return parseStashCommand(rest, argv);
    case "skill":
      return parseSkillCommand(rest);
    case "comments":
      return parseCommentsCommand(rest);
    default:
      throw new Error(`Unknown command: ${commandName}`);
  }
}
