import { describe, expect, test } from "bun:test";
import {
  PLATFORM_PACKAGE_MATRIX,
  binaryFilenameForSpec,
  buildOptionalDependencyMap,
  buildPlatformPackageManifest,
  getHostPlatformPackageSpec,
  getPlatformPackageSpecByName,
  getPlatformPackageSpecForHost,
  normalizeHostArch,
  normalizeHostPlatform,
  sortPlatformPackageSpecs,
  type PlatformPackageSpec,
} from "./prebuilt-package-helpers";

describe("prebuilt package helpers", () => {
  test("buildOptionalDependencyMap includes every supported platform package at one version", () => {
    const version = "9.9.9";
    const dependencies = buildOptionalDependencyMap(version);

    expect(Object.keys(dependencies).sort()).toEqual(
      PLATFORM_PACKAGE_MATRIX.map((spec) => spec.packageName).sort(),
    );
    expect(new Set(Object.values(dependencies))).toEqual(new Set([version]));
  });

  test("binaryFilenameForSpec keeps unix package binaries extensionless", () => {
    for (const spec of PLATFORM_PACKAGE_MATRIX) {
      if (spec.os === "windows") {
        continue;
      }
      expect(binaryFilenameForSpec(spec)).toBe("dunk");
    }
  });

  test("binaryFilenameForSpec adds .exe for windows packages", () => {
    const windowsSpec: PlatformPackageSpec = {
      packageName: "dunkdiff-windows-x64",
      os: "windows",
      cpu: "x64",
      binaryName: "dunk",
      binaryRelativePath: "bin/dunk.exe",
    };

    expect(binaryFilenameForSpec(windowsSpec)).toBe("dunk.exe");
  });

  test("normalizeHostPlatform and normalizeHostArch reject unsupported values", () => {
    expect(normalizeHostPlatform("linux")).toBe("linux");
    expect(normalizeHostPlatform("win32")).toBe("windows");
    expect(normalizeHostPlatform("freebsd" as NodeJS.Platform)).toBeUndefined();

    expect(normalizeHostArch("x64")).toBe("x64");
    expect(normalizeHostArch("arm64")).toBe("arm64");
    expect(normalizeHostArch("ia32" as NodeJS.Architecture)).toBeUndefined();
  });

  test("getPlatformPackageSpecByName returns known package specs", () => {
    expect(getPlatformPackageSpecByName("dunkdiff-linux-x64")?.cpu).toBe("x64");
    expect(getPlatformPackageSpecByName("dunkdiff-darwin-arm64")?.os).toBe("darwin");
    expect(getPlatformPackageSpecByName("dunk-does-not-exist")).toBeUndefined();
  });

  test("getPlatformPackageSpecForHost resolves supported combinations and rejects unsupported ones", () => {
    expect(getPlatformPackageSpecForHost("linux", "x64").packageName).toBe("dunkdiff-linux-x64");
    expect(getPlatformPackageSpecForHost("darwin", "arm64").packageName).toBe(
      "dunkdiff-darwin-arm64",
    );
    expect(() => getPlatformPackageSpecForHost("freebsd" as NodeJS.Platform, "x64")).toThrow(
      "Unsupported host platform for prebuilt packaging: freebsd",
    );
    expect(() => getPlatformPackageSpecForHost("linux", "ia32" as NodeJS.Architecture)).toThrow(
      "Unsupported host architecture for prebuilt packaging: ia32",
    );
    expect(getPlatformPackageSpecForHost("linux", "arm64").packageName).toBe(
      "dunkdiff-linux-arm64",
    );
  });

  test("getHostPlatformPackageSpec resolves the current machine", () => {
    expect(getHostPlatformPackageSpec()).toEqual(
      getPlatformPackageSpecForHost(process.platform, process.arch),
    );
  });

  test("buildPlatformPackageManifest declares the native binary as a bin entry", () => {
    const manifest = buildPlatformPackageManifest(
      {
        version: "1.2.3",
        description: "Desktop diff viewer",
        license: "MIT",
      },
      getPlatformPackageSpecForHost("linux", "x64"),
    );

    expect(manifest.name).toBe("dunkdiff-linux-x64");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.bin).toEqual({
      dunk: "./bin/dunk",
    });
    expect(manifest.os).toEqual(["linux"]);
    expect(manifest.cpu).toEqual(["x64"]);
  });

  test("sortPlatformPackageSpecs keeps package publish order stable", () => {
    const reversed = [...PLATFORM_PACKAGE_MATRIX].reverse();
    expect(sortPlatformPackageSpecs(reversed).map((spec) => spec.packageName)).toEqual([
      "dunkdiff-darwin-arm64",
      "dunkdiff-darwin-x64",
      "dunkdiff-linux-arm64",
      "dunkdiff-linux-x64",
      "dunkdiff-windows-x64",
    ]);
  });
});
