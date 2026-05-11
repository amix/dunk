import { describe, expect, test } from "bun:test";
import { isNewerVersion, resolveStartupUpdateNotice, selectUpdateNotice } from "./updateNotice";

describe("selectUpdateNotice", () => {
  test("returns null when the installed version is already current", () => {
    expect(selectUpdateNotice("1.2.3", { latest: "1.2.3" })).toBeNull();
  });

  test("returns null when the latest dist-tag is missing or non-stable", () => {
    expect(selectUpdateNotice("1.2.3", {})).toBeNull();
    expect(selectUpdateNotice("1.2.3", { latest: "1.2.4-beta.0" })).toBeNull();
    expect(selectUpdateNotice("1.2.3", { latest: 42 })).toBeNull();
  });

  test("returns a notice when latest is strictly newer", () => {
    const notice = selectUpdateNotice("0.11.0", { latest: "0.12.0" });
    expect(notice).not.toBeNull();
    expect(notice?.key).toBe("latest:0.12.0");
    expect(notice?.message).toContain("0.12.0");
    expect(notice?.message).toContain("npm i -g dunkdiff");
  });

  test("ignores a non-stable installed version", () => {
    expect(selectUpdateNotice("0.11.0-canary.4", { latest: "0.12.0" })).toBeNull();
    expect(selectUpdateNotice("0.0.0-unknown", { latest: "0.12.0" })).toBeNull();
  });
});

describe("isNewerVersion", () => {
  test("returns true only when candidate is strictly greater", () => {
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.3.0")).toBe(true);
    expect(isNewerVersion("1.2.3", "2.0.0")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3", "1.2.2")).toBe(false);
  });

  test("returns false on malformed versions instead of throwing", () => {
    expect(isNewerVersion("1.2.3", "not-a-version")).toBe(false);
  });
});

describe("resolveStartupUpdateNotice", () => {
  test("returns a notice when the fetched latest is newer", async () => {
    const notice = await resolveStartupUpdateNotice({
      fetchImpl: async () =>
        new Response(JSON.stringify({ latest: "9.9.9" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      resolveInstalledVersion: () => "0.11.0",
    });

    expect(notice?.message).toContain("9.9.9");
    expect(notice?.key).toBe("latest:9.9.9");
  });

  test("swallows network failures and returns null", async () => {
    const notice = await resolveStartupUpdateNotice({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      resolveInstalledVersion: () => "0.11.0",
    });

    expect(notice).toBeNull();
  });

  test("swallows non-2xx responses", async () => {
    const notice = await resolveStartupUpdateNotice({
      fetchImpl: async () => new Response("not found", { status: 404 }),
      resolveInstalledVersion: () => "0.11.0",
    });

    expect(notice).toBeNull();
  });
});
