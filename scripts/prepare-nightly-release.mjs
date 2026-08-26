import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [distArgument, publicArgument, updatesArgument, version] = process.argv.slice(2);
if (!distArgument || !publicArgument || !updatesArgument || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    "Usage: prepare-nightly-release.mjs <dist-directory> <public-directory> <updates-directory> <numeric-version>",
  );
}

const assets = [
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.zip$`),
    publicName: "Shift-Nightly-macOS-arm64.zip",
    update: true,
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.zip$`),
    publicName: "Shift-Nightly-macOS-x64.zip",
    update: true,
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.zip\\.blockmap$`),
    update: true,
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.zip\\.blockmap$`),
    update: true,
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.dmg$`),
    publicName: "Shift-Nightly-macOS-arm64.dmg",
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.dmg$`),
    publicName: "Shift-Nightly-macOS-x64.dmg",
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Windows-x64-Setup\\.exe$`),
    publicName: "Shift-Nightly-Windows-x64-Setup.exe",
    update: true,
  },
  {
    pattern: new RegExp(
      `Shift-Nightly-${escapeRegex(version)}-Windows-x64-Setup\\.exe\\.blockmap$`,
    ),
    update: true,
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Linux-x64\\.deb$`),
    publicName: "Shift-Nightly-Linux-x64.deb",
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Linux-x64\\.rpm$`),
    publicName: "Shift-Nightly-Linux-x64.rpm",
  },
  {
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Linux-x64\\.AppImage$`),
    publicName: "Shift-Nightly-Linux-x64.AppImage",
  },
];

const distRoot = path.resolve(distArgument);
const publicRoot = path.resolve(publicArgument);
const updatesRoot = path.resolve(updatesArgument);
await Promise.all([prepareEmptyDirectory(publicRoot), prepareEmptyDirectory(updatesRoot)]);

const files = await collectFiles(distRoot);
const checksums = [];

for (const asset of assets) {
  const matches = files.filter((file) => asset.pattern.test(path.basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected one source for ${asset.pattern}, found ${matches.length}`);
  }

  const source = matches[0];
  if (asset.publicName) {
    const destination = path.join(publicRoot, asset.publicName);
    await copyFile(source, destination);
    checksums.push(`${await sha256(destination)}  ${asset.publicName}`);
  }
  if (asset.update) {
    await copyFile(source, path.join(updatesRoot, path.basename(source)));
  }
}

await writeFile(path.join(publicRoot, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`);

async function prepareEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Nightly output directory is not empty: ${directory}`);
  }
}

async function collectFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
