/**
 * Session-lifetime startup-notice hook.
 *
 * Defers the npm dist-tags lookup until after the diff has rendered (so the
 * fetch never blocks first paint), shows the resulting one-liner in the
 * status bar for a few seconds, then re-checks once every 6 hours so a
 * long-lived session still picks up a freshly published release.
 *
 * The notice text is the only thing exposed to consumers; everything else is
 * internal scheduling.
 */
import { useEffect, useRef, useState } from "react";
import type { UpdateNotice } from "../../core/updateNotice";

// Wait this long after mount before the dist-tag fetch so it never races first paint.
const STARTUP_NOTICE_DELAY_MS = 1_200;
// How long the notice stays visible in the status bar before fading back to the default hint.
const STARTUP_NOTICE_DURATION_MS = 7_000;
// Re-check every 6 hours so long-lived sessions still pick up a freshly published release.
const STARTUP_NOTICE_REPEAT_MS = 6 * 60 * 60 * 1_000;

interface StartupUpdateNoticeOptions {
  enabled: boolean;
  resolver?: () => Promise<UpdateNotice | null>;
}

/** Returns the active notice text (or null) for the current session. */
export function useStartupUpdateNotice({
  enabled,
  resolver,
}: StartupUpdateNoticeOptions): string | null {
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const lastShownKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !resolver) {
      setNoticeText(null);
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    const clearDismissTimer = () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    };

    const runUpdateCheck = () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      void resolver()
        .then((notice) => {
          if (cancelled || !notice || notice.key === lastShownKeyRef.current) {
            return;
          }
          lastShownKeyRef.current = notice.key;
          setNoticeText(notice.message);
          clearDismissTimer();
          dismissTimer = setTimeout(() => {
            if (!cancelled) {
              setNoticeText(null);
              dismissTimer = null;
            }
          }, STARTUP_NOTICE_DURATION_MS);
          dismissTimer.unref?.();
        })
        .catch(() => {
          // Non-blocking lookup — swallow.
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const delayTimer = setTimeout(runUpdateCheck, STARTUP_NOTICE_DELAY_MS);
    delayTimer.unref?.();
    const repeatTimer = setInterval(runUpdateCheck, STARTUP_NOTICE_REPEAT_MS);
    repeatTimer.unref?.();

    return () => {
      cancelled = true;
      clearTimeout(delayTimer);
      clearInterval(repeatTimer);
      clearDismissTimer();
    };
  }, [enabled, resolver]);

  return noticeText;
}
