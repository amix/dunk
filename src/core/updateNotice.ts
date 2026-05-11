/**
 * Transient "update available" startup notice.
 *
 * Hits the npm dist-tags endpoint for `dunkdiff`, compares the published
 * `latest` against the installed version, and returns a one-line notice when
 * the published version is strictly newer. Network/parse failures are silent
 * — this is a nice-to-have for someone running `dunk diff`, never a blocker.
 */
import { resolveCliVersion } from "./version";

const DIST_TAGS_URL = "https://registry.npmjs.org/-/package/dunkdiff/dist-tags";
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/;
const UNKNOWN_CLI_VERSION = "0.0.0-unknown";
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export interface UpdateNotice {
  /** Stable per-version key so the UI can suppress duplicates across re-fetches. */
  key: string;
  /** Human-readable single-line message rendered in the status bar. */
  message: string;
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface UpdateNoticeDeps {
  fetchImpl?: FetchImpl;
  fetchTimeoutMs?: number;
  resolveInstalledVersion?: () => string;
}

/** Return whether a string is normalized stable semver (no prerelease / build). */
function isStableVersion(value: string): boolean {
  return STABLE_SEMVER.test(value);
}

/** Compare two stable semver strings; true when `candidate` is strictly newer than `current`. */
export function isNewerVersion(current: string, candidate: string): boolean {
  try {
    return Bun.semver.order(current, candidate) < 0;
  } catch {
    return false;
  }
}

/** Choose the best notice — currently just "latest" channel — or null when nothing newer is published. */
export function selectUpdateNotice(
  installedVersion: string,
  distTags: { latest?: unknown },
): UpdateNotice | null {
  if (installedVersion === UNKNOWN_CLI_VERSION || !isStableVersion(installedVersion)) {
    return null;
  }

  const latest = typeof distTags.latest === "string" ? distTags.latest : null;
  if (!latest || !isStableVersion(latest)) {
    return null;
  }

  if (!isNewerVersion(installedVersion, latest)) {
    return null;
  }

  return {
    key: `latest:${latest}`,
    message: `dunk ${latest} is out — \`npm i -g dunkdiff\` to update`,
  };
}

/** Wrap fetch with an AbortController-backed timeout, unref-safe on Node/Bun. */
function withFetchTimeout(timeoutMs: number): {
  signal: AbortSignal | undefined;
  dispose: () => void;
} {
  if (typeof AbortController === "undefined") {
    return { signal: undefined, dispose: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

/**
 * Fetch dist-tags and return the matching notice, or null. Side-effect-free
 * on failure: timeouts, non-2xx responses, JSON parse errors, and missing
 * fields all resolve to null so the caller never has to log noise.
 */
export async function resolveStartupUpdateNotice(
  deps: UpdateNoticeDeps = {},
): Promise<UpdateNotice | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveInstalledVersion = deps.resolveInstalledVersion ?? resolveCliVersion;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { signal, dispose } = withFetchTimeout(fetchTimeoutMs);

  try {
    const response = await fetchImpl(DIST_TAGS_URL, { signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    return selectUpdateNotice(resolveInstalledVersion(), payload as { latest?: unknown });
  } catch {
    return null;
  } finally {
    dispose();
  }
}
