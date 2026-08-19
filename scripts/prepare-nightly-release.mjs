import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [distArgument, outputArgument, version] = process.argv.slice(2);
if (!distArgument || !outputArgument || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    "Usage: prepare-nightly-release.mjs <dist-directory> <output-directory> <numeric-version>",
  );
}

const assets = [
  {
    destinations: (source) => ["Shift-Nightly-macOS-arm64.zip", path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.zip$`),
  },
  {
    destinations: (source) => ["Shift-Nightly-macOS-x64.zip", path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.zip$`),
  },
  {
    destinations: (source) => [path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.zip\\.blockmap$`),
  },
  {
    destinations: (source) => [path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.zip\\.blockmap$`),
  },
  {
    destinations: (source) => ["Shift-Nightly-macOS-arm64.dmg", path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-arm64\\.dmg$`),
  },
  {
    destinations: (source) => ["Shift-Nightly-macOS-x64.dmg", path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-macOS-x64\\.dmg$`),
  },
  {
    destinations: (source) => ["Shift-Nightly-Windows-x64.exe", path.basename(source)],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Windows-x64-Setup\\.exe$`),
  },
  {
    destinations: (source) => [path.basename(source)],
    pattern: new RegExp(
      `Shift-Nightly-${escapeRegex(version)}-Windows-x64-Setup\\.exe\\.blockmap$`,
    ),
  },
  {
    destinations: () => ["Shift-Nightly-Linux-x64.deb"],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Linux-x64\\.deb$`),
  },
  {
    destinations: () => ["Shift-Nightly-Linux-x64.rpm"],
    pattern: new RegExp(`Shift-Nightly-${escapeRegex(version)}-Linux-x64\\.rpm$`),
  },
];

const distRoot = path.resolve(distArgument);
const outputRoot = path.resolve(outputArgument);
await mkdir(outputRoot, { recursive: true });

if ((await readdir(outputRoot)).length > 0) {
  throw new Error(`Nightly output directory is not empty: ${outputRoot}`);
}

const files = await collectFiles(distRoot);
const checksums = [];

for (const asset of assets) {
  const matches = files.filter((file) => asset.pattern.test(path.basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected one source for ${asset.pattern}, found ${matches.length}`);
  }

  const source = matches[0];
  for (const destinationName of asset.destinations(source)) {
    const destination = path.join(outputRoot, destinationName);
    await copyFile(source, destination);
    checksums.push(`${await sha256(destination)}  ${destinationName}`);
  }
}

await writeFile(path.join(outputRoot, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`);

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
