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

  // Keep app-only modules behind the app startup branch so help, version,
  // and comments commands stay on the cold path.
  // Import @opentui/core before React bindings; those modules read core
  // exports during initialization.
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
