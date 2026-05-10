import { spawn } from "node:child_process";

/**
 * Copy `text` to the system clipboard. Returns `true` when an OS-native
 * helper accepted the input. Stays best-effort: a missing helper resolves
 * to `false` rather than throwing, since this is wired to a passive UI
 * action (selection auto-copy) where failure should be silent.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const candidates = pickClipboardCommands();
  for (const command of candidates) {
    if (await runClipboardCommand(command, text)) {
      return true;
    }
  }

  return false;
}

interface ClipboardCommand {
  program: string;
  args: string[];
}

/** Pick the candidate clipboard helpers for the current platform. */
function pickClipboardCommands(): ClipboardCommand[] {
  if (process.platform === "darwin") {
    return [{ program: "pbcopy", args: [] }];
  }

  if (process.platform === "win32") {
    return [{ program: "clip", args: [] }];
  }

  // Linux/BSD: prefer Wayland, fall back to xclip / xsel.
  return [
    { program: "wl-copy", args: [] },
    { program: "xclip", args: ["-selection", "clipboard"] },
    { program: "xsel", args: ["--clipboard", "--input"] },
  ];
}

/** Run one clipboard helper with the text on stdin. Resolves to true on exit-0. */
function runClipboardCommand(command: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command.program, command.args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));

    child.stdin?.end(text, "utf8");
  });
}
