import { readFile, writeFile } from "node:fs/promises";

const productFiles = ["package.json", "apps/desktop/package.json"];
const semverPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function readPackage(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function checkVersion(expectedVersion) {
  const packages = await Promise.all(productFiles.map(readPackage));
  const versions = packages.map((packageJson) => packageJson.version);
  const [productVersion] = versions;

  if (!semverPattern.test(productVersion)) {
    throw new Error(`Invalid product version: ${productVersion}`);
  }

  if (versions.some((version) => version !== productVersion)) {
    throw new Error(
      `Product versions disagree: ${productFiles.map((path, index) => `${path}=${versions[index]}`).join(", ")}`,
    );
  }

  if (expectedVersion && productVersion !== expectedVersion) {
    throw new Error(`Expected product version ${expectedVersion}, found ${productVersion}`);
  }

  console.log(productVersion);
}

async function setVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid product version: ${version}`);
  }

  for (const path of productFiles) {
    const packageJson = await readPackage(path);
    packageJson.version = version;
    await writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  await checkVersion(version);
}

const [command = "check", version] = process.argv.slice(2);

switch (command) {
  case "check":
    await checkVersion(version);
    break;
  case "set":
    if (!version) throw new Error("Usage: product-version.mjs set <version>");
    await setVersion(version);
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}
