#!/usr/bin/env bun

import { formatCliError } from "./core/errors";
import type { JobControlInterruptSupport, JobControlSuspendSupport } from "./core/jobControl";
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
    jobControl,
    { shouldUseMouseForApp },
    { resolveStartupUpdateNotice },
    { AppHost },
  ] = await Promise.all([
    import("@opentui/react"),
    import("./core/shutdown"),
    import("./core/jobControl"),
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
    // Ctrl-C is routed through the job-control interrupt handler below so it
    // runs dunk's ordered shutdown instead of OpenTUI's hard exit.
    exitOnCtrlC: false,
    openConsoleOnError: true,
    onDestroy: () => controllingTerminal?.close(),
  });

  const root = createRoot(renderer);
  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  let shuttingDown = false;
  let jobControlSuspendSupport: JobControlSuspendSupport = { dispose: () => undefined };
  let jobControlInterruptSupport: JobControlInterruptSupport = { dispose: () => undefined };

  /** Tear down the renderer before exit so the primary terminal screen comes back cleanly. */
  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const signal of shutdownSignals) {
      process.off(signal, shutdown);
    }
    jobControlInterruptSupport.dispose();
    jobControlSuspendSupport.dispose();
    shutdownSession({ root, renderer });
  }

  for (const signal of shutdownSignals) {
    process.once(signal, shutdown);
  }
  jobControlInterruptSupport = jobControl.installJobControlInterruptSupport(renderer, shutdown);
  jobControlSuspendSupport = jobControl.installJobControlSuspendSupport(renderer);

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
