import { useCallback, useState } from "react";
import { resolveConfiguredCliInput } from "../core/config";
import { loadAppBootstrap } from "../core/loaders";
import { resolveRuntimeCliInput } from "../core/terminal";
import type { AppBootstrap, CliInput } from "../core/types";
import { App } from "./App";

/** Keep one live dunk app mounted while supporting fs-driven reloads. */
export function AppHost({
  bootstrap,
  onQuit = () => process.exit(0),
}: {
  bootstrap: AppBootstrap;
  onQuit?: () => void;
}) {
  const [activeBootstrap, setActiveBootstrap] = useState(bootstrap);
  const [appVersion, setAppVersion] = useState(0);

  const reloadSession = useCallback(
    async (nextInput: CliInput, options?: { resetApp?: boolean; sourcePath?: string }) => {
      // Re-run the same startup normalization pipeline used on first launch so reloads honor
      // runtime defaults and config layering instead of assuming `nextInput` is already final.
      const runtimeInput = resolveRuntimeCliInput(nextInput);
      const configuredInput = resolveConfiguredCliInput(runtimeInput, {
        cwd: options?.sourcePath,
      }).input;
      const nextBootstrap = await loadAppBootstrap(configuredInput, {
        cwd: options?.sourcePath,
      });

      setActiveBootstrap(nextBootstrap);
      if (options?.resetApp !== false) {
        // Bumping the key forces a full App remount. Callers that pass `resetApp: false` get a
        // soft reload that preserves in-memory UI state like selection, filter text, and pane size.
        setAppVersion((current) => current + 1);
      }
    },
    [],
  );

  return (
    <App
      key={appVersion}
      bootstrap={activeBootstrap}
      onQuit={onQuit}
      onReloadSession={reloadSession}
    />
  );
}
