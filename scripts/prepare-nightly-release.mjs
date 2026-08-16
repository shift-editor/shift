import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const assets = [
  {
    destination: "Shift-Nightly-macOS-arm64.zip",
    pattern: /(^|\/)zip\/darwin\/arm64\/[^/]+\.zip$/,
  },
  {
    destination: "Shift-Nightly-macOS-x64.zip",
    pattern: /(^|\/)zip\/darwin\/x64\/[^/]+\.zip$/,
  },
  {
    destination: "Shift-Nightly-Windows-x64.exe",
    pattern: /(^|\/)squirrel\.windows\/x64\/[^/]+Setup\.exe$/,
  },
  {
    destination: "Shift-Nightly-Linux-x64.deb",
    pattern: /(^|\/)deb\/x64\/[^/]+\.deb$/,
  },
  {
    destination: "Shift-Nightly-Linux-x64.rpm",
    pattern: /(^|\/)rpm\/x64\/[^/]+\.rpm$/,
  },
];

async function collectFiles(root) {
  const files = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
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

const [distArgument, outputArgument] = process.argv.slice(2);
if (!distArgument || !outputArgument) {
  throw new Error("Usage: prepare-nightly-release.mjs <dist-directory> <output-directory>");
}

const distRoot = path.resolve(distArgument);
const outputRoot = path.resolve(outputArgument);
await mkdir(outputRoot, { recursive: true });

const existingOutput = await readdir(outputRoot);
if (existingOutput.length > 0) {
  throw new Error(`Nightly output directory is not empty: ${outputRoot}`);
}

const files = await collectFiles(distRoot);
const checksums = [];

for (const asset of assets) {
  const matches = files.filter((file) =>
    asset.pattern.test(path.relative(distRoot, file).split(path.sep).join("/")),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one source for ${asset.destination}, found ${matches.length}`);
  }

  const destination = path.join(outputRoot, asset.destination);
  await copyFile(matches[0], destination);
  checksums.push(`${await sha256(destination)}  ${asset.destination}`);
}

await writeFile(path.join(outputRoot, "SHA256SUMS"), `${checksums.join("\n")}\n`);
