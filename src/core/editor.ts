/**
 * Resolve the user's editor and how to open one file at a specific line.
 *
 * Reads `$VISUAL` then `$EDITOR`. Each editor needs its own argument shape:
 * vim/nvim/nano use `+LINE file`; VS Code, Cursor, Sublime, and Zed use a
 * `file:LINE` suffix; Helix uses `file:LINE`. Unknown editors fall back to
 * just the file path.
 */
import { spawn, type SpawnOptions } from "node:child_process";

export interface EditorLaunchPlan {
  /** Executable + args, ready to pass to spawn. */
  command: string[];
  /** True when the editor needs the host TTY (terminal editors). */
  needsTty: boolean;
}

export interface ResolveEditorOptions {
  visual?: string;
  editor?: string;
}

/** Resolve the launch plan for one editor + file:line target. */
export function resolveEditorLaunch(
  filePath: string,
  line: number,
  options: ResolveEditorOptions = {},
): EditorLaunchPlan | null {
  const raw = (options.visual ?? options.editor ?? "").trim();
  if (raw.length === 0) {
    return null;
  }

  // Allow `EDITOR='nvim --some-flag'` by splitting on whitespace, then dispatching
  // by the executable basename so flag-prefixed commands still match the right
  // editor convention.
  const parts = splitCommand(raw);
  const program = parts[0]!;
  const baseName = lastPathSegment(program).toLowerCase();
  const flags = parts.slice(1);

  switch (baseName) {
    case "vim":
    case "nvim":
    case "vi":
    case "nano":
    case "neovide":
      return {
        command: [program, ...flags, `+${line}`, filePath],
        needsTty: baseName !== "neovide",
      };
    case "code":
    case "code-insiders":
    case "cursor":
    case "windsurf":
      return {
        command: [program, ...flags, "--goto", `${filePath}:${line}`],
        needsTty: false,
      };
    case "subl":
    case "sublime":
      return {
        command: [program, ...flags, `${filePath}:${line}`],
        needsTty: false,
      };
    case "zed":
    case "hx":
    case "helix":
      return {
        command: [program, ...flags, `${filePath}:${line}`],
        needsTty: baseName === "hx" || baseName === "helix",
      };
    case "emacs":
    case "emacsclient":
      return {
        command: [program, ...flags, `+${line}`, filePath],
        needsTty: baseName === "emacs",
      };
    default:
      // Fall back to "+LINE file" — the most common terminal-editor shape — and
      // assume terminal handoff. Adding new editors here is a one-line change.
      return {
        command: [program, ...flags, `+${line}`, filePath],
        needsTty: true,
      };
  }
}

/** Run an editor launch plan and resolve when it exits. */
export async function runEditorLaunch(
  plan: EditorLaunchPlan,
  options: { cwd?: string } = {},
): Promise<{ exitCode: number | null }> {
  return new Promise((resolveExit, rejectExit) => {
    const [program, ...args] = plan.command;
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd ?? process.cwd(),
      stdio: plan.needsTty ? "inherit" : "ignore",
      detached: !plan.needsTty,
    };

    const child = spawn(program!, args, spawnOptions);
    if (!plan.needsTty) {
      // Detach GUI editors so killing tunk does not also kill the editor.
      child.unref();
      resolveExit({ exitCode: 0 });
      return;
    }

    child.on("error", rejectExit);
    child.on("exit", (code) => resolveExit({ exitCode: code }));
  });
}

/** Split a command string on whitespace, treating quoted segments as one token. */
function splitCommand(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of raw.matchAll(re)) {
    out.push(match[1] ?? match[2] ?? match[3]!);
  }

  return out;
}

/** Strip directory components from a program path. */
function lastPathSegment(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}
