import { readFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const distribution = process.env.SHIFT_DISTRIBUTION ?? "release";
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Invalid SHIFT_DISTRIBUTION: ${distribution}`);
}

const isNightly = distribution === "nightly";
const productName = isNightly ? "Shift Nightly" : "Shift";
const packageName = isNightly ? "shift-nightly" : "shift";
const executableName = packageName;
const appBundleId = isNightly ? "app.shift.nightly" : "app.shift";
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
const productVersion = packageJson.version as string;
const platformVersion = productVersion.split("-", 1)[0];
const signMacos = process.env.SIGN_MACOS === "1";

if (signMacos) {
  for (const name of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!process.env[name]) throw new Error(`${name} is required when SIGN_MACOS=1`);
  }
}

const nativeBridgeFiles: Record<string, string> = {
  "darwin-arm64": "shift-bridge.darwin-arm64.node",
  "darwin-x64": "shift-bridge.darwin-x64.node",
  "linux-x64": "shift-bridge.linux-x64-gnu.node",
  "win32-x64": "shift-bridge.win32-x64-msvc.node",
};

const config: ForgeConfig = {
  packagerConfig: {
    name: productName,
    executableName,
    appBundleId,
    helperBundleId: `${appBundleId}.helper`,
    appCategoryType: "public.app-category.graphics-design",
    appCopyright: "Copyright © 2026 Shift",
    appVersion: platformVersion,
    buildVersion: platformVersion,
    asar: {
      unpack: "**/*.node",
    },
    icon: "../../icons/icon",
    extraResource: ["../../icons/icon.png", "../../LICENSE"],
    win32metadata: {
      CompanyName: "Shift",
      FileDescription: productName,
      InternalName: packageName,
      OriginalFilename: `${executableName}.exe`,
      ProductName: productName,
    },
    ...(signMacos
      ? {
          osxSign: true,
          osxNotarize: {
            appleId: process.env.APPLE_ID!,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: packageName.replaceAll("-", "_"),
      setupExe: `${productName}-${productVersion}-Setup.exe`,
      noMsi: true,
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        name: packageName,
        productName,
        genericName: "Font Editor",
        description: "Font editor for drawing, spacing, and shaping type",
        license: "GPL-3.0-only",
        homepage: "https://shift.app",
        bin: executableName,
        icon: "../../icons/icon.png",
        categories: ["Graphics"],
      },
    }),
    new MakerDeb({
      options: {
        name: packageName,
        productName,
        genericName: "Font Editor",
        description: "Font editor for drawing, spacing, and shaping type",
        productDescription: "Shift is a font editor for drawing, spacing, and shaping type.",
        section: "graphics",
        priority: "optional",
        maintainer: "Kostya Farber <kostya.farber@gmail.com>",
        homepage: "https://shift.app",
        bin: executableName,
        icon: "../../icons/icon.png",
        categories: ["Graphics"],
      },
    }),
  ],
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const nativeBridgeFile = nativeBridgeFiles[`${platform}-${arch}`];
      if (!nativeBridgeFile) {
        throw new Error(`Unsupported native bridge package target: ${platform}-${arch}`);
      }

      const bridgeSource = path.resolve(__dirname, "../../crates/shift-bridge");
      const bridgeDestination = path.join(buildPath, "node_modules", "shift-bridge");
      await mkdir(bridgeDestination, { recursive: true });
      await Promise.all(
        ["index.js", "package.json", nativeBridgeFile].map((file) =>
          cp(path.join(bridgeSource, file), path.join(bridgeDestination, file)),
        ),
      );
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/utility/workspace.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

/** @public */
export default config;
