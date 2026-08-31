import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AfterPackContext, Configuration } from "electron-builder";

const execFileAsync = promisify(execFile);

const distribution = process.env.SHIFT_DISTRIBUTION ?? "release";
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Invalid SHIFT_DISTRIBUTION: ${distribution}`);
}

const buildArchitecture = process.env.SHIFT_BUILD_ARCH ?? process.arch;
if (buildArchitecture !== "arm64" && buildArchitecture !== "x64") {
  throw new Error(`Unsupported desktop build architecture: ${buildArchitecture}`);
}

const nativeBridgeFiles: Record<string, string> = {
  "darwin-arm64": "shift-bridge.darwin-arm64.node",
  "darwin-x64": "shift-bridge.darwin-x64.node",
  "linux-x64": "shift-bridge.linux-x64-gnu.node",
  "win32-x64": "shift-bridge.win32-x64-msvc.node",
};
const nativeBridgeFile = nativeBridgeFiles[`${process.platform}-${buildArchitecture}`];
if (!nativeBridgeFile) {
  throw new Error(`Unsupported native bridge target: ${process.platform}-${buildArchitecture}`);
}

const isNightly = distribution === "nightly";
const productName = isNightly ? "Shift Nightly" : "Shift";
const packageName = isNightly ? "shift-nightly" : "shift";
const artifactName = isNightly ? "Shift-Nightly" : "Shift";
const appId = isNightly ? "app.shift.nightly" : "app.shift";
const iconName = isNightly ? "nightly" : "icon";
const documentIconName = "shift-document";
const documentBadgeName = "shift-document-badge-v2";
const documentTypeIdentifier = "app.shift.document.v2";
const documentMimeType = "application/x-shift-document";
const linuxDocumentIconName = isNightly ? "shift-nightly-document" : documentIconName;
const linuxDocumentIconSizes = [16, 32, 48, 64, 128, 256, 512];
const linuxPackageFiles = [
  `${path.join(__dirname, `resources/linux/${distribution}.xml`)}=/usr/share/mime/packages/${packageName}.xml`,
  ...linuxDocumentIconSizes.map(
    (size) =>
      `${path.join(__dirname, `../../icons/${documentIconName}-${size}x${size}.png`)}=/usr/share/icons/hicolor/${size}x${size}/mimetypes/${linuxDocumentIconName}.png`,
  ),
];
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
const productVersion = packageJson.version as string;
const updateBaseUrl =
  process.env.SHIFT_UPDATE_BASE_URL ?? "https://shift-editor.github.io/shift/updates";
const channelUrl = `${updateBaseUrl.replace(/\/$/, "")}/${distribution}/${process.platform}/${buildArchitecture}`;
const signMacos = process.env.SIGN_MACOS === "1";
const installedAppScreenshots = process.env.SHIFT_INSTALLED_APP_SCREENSHOTS === "1";

if (signMacos) {
  for (const name of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!process.env[name]) throw new Error(`${name} is required when SIGN_MACOS=1`);
  }
}

async function compileMacosAssetCatalog(context: AfterPackContext) {
  if (context.electronPlatformName !== "darwin") return;

  const outputPath = await mkdtemp(path.join(os.tmpdir(), "shift-macos-assets-"));
  const infoPath = path.join(outputPath, "assetcatalog_generated_info.plist");
  const appIconPath = path.join(__dirname, `../../icons/${iconName}.icon`);
  const documentAssetsPath = path.join(__dirname, "../../icons/shift-document.xcassets");
  const packagedAssetsPath = path.join(
    context.appOutDir,
    `${productName}.app`,
    "Contents/Resources/Assets.car",
  );

  try {
    await execFileAsync("xcrun", [
      "actool",
      appIconPath,
      documentAssetsPath,
      "--compile",
      outputPath,
      "--output-format",
      "human-readable-text",
      "--notices",
      "--warnings",
      "--output-partial-info-plist",
      infoPath,
      "--app-icon",
      "Icon",
      "--include-all-app-icons",
      "--enable-on-demand-resources",
      "NO",
      "--development-region",
      "en",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
    ]);
    await copyFile(path.join(outputPath, "Assets.car"), packagedAssetsPath);
  } finally {
    await rm(outputPath, { force: true, recursive: true });
  }
}

const config: Configuration = {
  afterPack: compileMacosAssetCatalog,
  appId,
  productName,
  buildVersion: productVersion,
  copyright: "Copyright © 2026 Shift",
  directories: {
    output: `out/${process.platform}-${buildArchitecture}`,
    buildResources: "../../icons",
  },
  extraMetadata: {
    name: packageName,
    productName,
    version: productVersion,
    homepage: "https://shift.graphics",
    desktopName: packageName,
  },
  files: [
    ".vite/**/*",
    "package.json",
    "!node_modules/**/*",
    {
      from: "../../crates/shift-bridge",
      to: "node_modules/shift-bridge",
      filter: ["index.js", "package.json", nativeBridgeFile],
    },
  ],
  extraResources: [
    { from: `../../icons/${iconName}.png`, to: `${iconName}.png` },
    { from: "../../LICENSE", to: "LICENSE" },
  ],
  asar: true,
  asarUnpack: ["**/*.node"],
  npmRebuild: false,
  forceCodeSigning: signMacos,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: installedAppScreenshots,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  publish: [{ provider: "generic", url: channelUrl }],
  mac: {
    target: ["zip", "dmg"],
    category: "public.app-category.graphics-design",
    icon: `../../icons/${iconName}.icon`,
    identity: signMacos ? undefined : null,
    hardenedRuntime: true,
    notarize: signMacos,
    helperBundleId: `${appId}.helper`,
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeIconSystemGenerated: true,
          CFBundleTypeName: "Shift Document",
          CFBundleTypeRole: "Editor",
          LSHandlerRank: isNightly ? "Alternate" : "Owner",
          LSItemContentTypes: [documentTypeIdentifier],
        },
      ],
      UTExportedTypeDeclarations: [
        {
          UTTypeConformsTo: ["public.data", "public.content"],
          UTTypeDescription: "Shift font document",
          UTTypeIcons: {
            UTTypeIconBadgeName: documentBadgeName,
            UTTypeIconText: "SHIFT",
          },
          UTTypeIdentifier: documentTypeIdentifier,
          UTTypeTagSpecification: {
            "public.filename-extension": ["shift"],
            "public.mime-type": [documentMimeType],
          },
        },
      ],
    },
    artifactName: `${artifactName}-${productVersion}-macOS-${buildArchitecture}.\${ext}`,
  },
  dmg: {
    icon: `../../icons/${iconName}.icns`,
    artifactName: `${artifactName}-${productVersion}-macOS-${buildArchitecture}.\${ext}`,
  },
  win: {
    target: ["nsis"],
    icon: `../../icons/${iconName}.ico`,
    executableName: packageName,
    artifactName: `${artifactName}-${productVersion}-Windows-${buildArchitecture}-Setup.\${ext}`,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    include: path.join(__dirname, "resources/windows/installer.nsh"),
    artifactName: `${artifactName}-${productVersion}-Windows-${buildArchitecture}-Setup.\${ext}`,
  },
  linux: {
    target: ["deb", "rpm", "AppImage"],
    icon: `../../icons/${iconName}.png`,
    executableName: packageName,
    category: "Graphics",
    synopsis: "Font editor",
    description: "Font editor for drawing, spacing, and shaping type",
    maintainer: "Kostya Farber <kostya.farber@gmail.com>",
    vendor: "Shift",
    syncDesktopName: true,
    mimeTypes: [documentMimeType],
    artifactName: `${artifactName}-${productVersion}-Linux-${buildArchitecture}.\${ext}`,
  },
  appImage: {
    artifactName: `${artifactName}-${productVersion}-Linux-${buildArchitecture}.\${ext}`,
  },
  deb: {
    fpm: isNightly
      ? linuxPackageFiles
      : [
          "--config-files",
          "/etc/apt/keyrings/shift-repository.gpg",
          "--config-files",
          "/etc/apt/sources.list.d/shift.sources",
          ...linuxPackageFiles,
          `${path.join(__dirname, "resources/linux/shift-repository.gpg")}=/etc/apt/keyrings/shift-repository.gpg`,
          `${path.join(__dirname, "resources/linux/shift.sources")}=/etc/apt/sources.list.d/shift.sources`,
        ],
  },
  rpm: {
    fpm: linuxPackageFiles,
  },
};

/** @public */
export default config;
