#!/usr/bin/env bun

import { formatCliError } from "./core/errors";
import { prepareStartupPlan } from "./core/startup";

async function main() {
  const startupPlan = await prepareStartupPlan();

  if (startupPlan.kind === "help") {
    process.stdout.write(startupPlan.text);
    process.exit(0);
  }

  if (startupPlan.kind === "plain-text-pager") {
    const { pagePlainText } = await import("./core/pager");
    await pagePlainText(startupPlan.text);
    process.exit(0);
  }

  if (startupPlan.kind !== "app") {
    throw new Error("Unreachable startup plan.");
  }

  // From here on we're launching the alternate-screen TUI. All the heavy
  // render-side modules — OpenTUI, React, AppHost, updateNotice, terminal —
  // are dynamic-imported behind this branch so cold-paths like `--help`,
  // `--version`, and `dunk comments {list,show,resolve}` don't pay for
  // ~60 ms of Pierre + OpenTUI + tree-sitter module parsing they never use.
  //
  // Load @opentui/core first and sequentially: @opentui/react and the rest
  // of the UI tree re-export symbols from it at module-init time, and a
  // parallel Promise.all races their initialization against the core's,
  // surfacing as `Cannot access 'TextNodeRenderable' before initialization`.
  const { createCliRenderer } = await import("@opentui/core");
  const [
    { createRoot },
    { shutdownSession },
    { shouldUseMouseForApp },
    { resolveStartupUpdateNotice },
    { AppHost },
  ] = await Promise.all([
    import("@opentui/react"),
    import("./core/shutdown"),
    import("./core/terminal"),
    import("./core/updateNotice"),
    import("./ui/AppHost"),
  ]);

  const { bootstrap, controllingTerminal } = startupPlan;

  const renderer = await createCliRenderer({
    stdin: controllingTerminal?.stdin,
    stdout: process.stdout,
    useMouse: shouldUseMouseForApp({
      hasControllingTerminal: Boolean(controllingTerminal),
    }),
    useAlternateScreen: true,
    exitOnCtrlC: true,
    openConsoleOnError: true,
    onDestroy: () => controllingTerminal?.close(),
  });

  const root = createRoot(renderer);
  let shuttingDown = false;

  /** Tear down the renderer before exit so the primary terminal screen comes back cleanly. */
  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    shutdownSession({ root, renderer });
  }

  // The app owns the full alternate screen session from this point on.
  root.render(
    <AppHost
      bootstrap={bootstrap}
      onQuit={shutdown}
      startupNoticeResolver={resolveStartupUpdateNotice}
    />,
  );
}

await main().catch((error) => {
  process.stderr.write(formatCliError(error));
  process.exit(1);
});
