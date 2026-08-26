import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+$/;
const architecture = "x86_64";
const debianArchitecture = "amd64";

export async function stageLinuxPackages({ artifactsRoot, repositoryRoot, version }) {
  validateVersion(version);
  const artifacts = path.resolve(artifactsRoot);
  const repository = path.resolve(repositoryRoot);
  await prepareEmptyDirectory(repository);

  const files = await collectFiles(artifacts);
  const deb = findArtifact(files, `Shift-${version}-Linux-x64.deb`);
  const rpm = findArtifact(files, `Shift-${version}-Linux-x64.rpm`);
  findArtifact(files, `Shift-${version}-Linux-x64.AppImage`);

  const debDestination = path.join(
    repository,
    "apt",
    "pool",
    "main",
    "s",
    "shift",
    `shift_${version}_${debianArchitecture}.deb`,
  );
  const rpmDestination = path.join(
    repository,
    "rpm",
    "releases",
    version,
    architecture,
    `shift-${version}-1.${architecture}.rpm`,
  );

  await Promise.all([
    copy(deb, debDestination),
    copy(rpm, rpmDestination),
    mkdir(path.join(repository, "apt", "dists", "release", "main", "binary-amd64"), {
      recursive: true,
    }),
  ]);

  return { deb: debDestination, rpm: rpmDestination };
}

export async function finalizeLinuxRepositories({ repositoryRoot, version, baseUrl, publishedAt }) {
  validateVersion(version);
  const repository = path.resolve(repositoryRoot);
  const packageBaseUrl = validateBaseUrl(baseUrl);
  const publicationDate = parsePublicationDate(publishedAt);
  const aptRoot = path.join(repository, "apt");
  const aptDistribution = path.join(aptRoot, "dists", "release");
  const aptBinary = path.join(aptDistribution, "main", "binary-amd64");
  const rpmRoot = path.join(repository, "rpm", "releases", version, architecture);
  const repomd = path.join(rpmRoot, "repodata", "repomd.xml");
  const repomdSignature = `${repomd}.asc`;
  const packages = [path.join(aptBinary, "Packages"), path.join(aptBinary, "Packages.gz")];

  await Promise.all([
    requireFile(repomd),
    requireFile(repomdSignature),
    ...packages.map((file) => requireFile(file)),
  ]);

  const releaseSections = [];
  for (const algorithm of ["sha256", "sha512"]) {
    const entries = [];
    for (const file of packages) {
      const digest = await hashFile(file, algorithm);
      const relative = relativePath(aptDistribution, file);
      const byHash = path.join(path.dirname(file), "by-hash", algorithm.toUpperCase(), digest);
      await copy(file, byHash);
      entries.push(` ${digest} ${(await stat(file)).size} ${relative}`);
    }
    releaseSections.push(`${algorithm.toUpperCase()}:\n${entries.join("\n")}`);
  }

  const release = [
    "Origin: Shift",
    "Label: Shift",
    "Suite: release",
    "Codename: release",
    `Date: ${publicationDate.toUTCString()}`,
    "Architectures: amd64",
    "Components: main",
    "Description: Shift font editor packages",
    "Acquire-By-Hash: yes",
    ...releaseSections,
    "",
  ].join("\n");
  await writeFile(path.join(aptDistribution, "Release"), release);

  const repomdSize = (await stat(repomd)).size;
  const repomdUrl = `${packageBaseUrl}/rpm/releases/${version}/${architecture}/repodata/repomd.xml`;
  const metalink = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<metalink version="3.0" xmlns="http://www.metalinker.org/" type="static" pubdate="${publicationDate.toUTCString()}" generator="Shift">`,
    " <files>",
    '  <file name="repomd.xml">',
    `   <size>${repomdSize}</size>`,
    "   <verification>",
    `    <hash type="sha256">${await hashFile(repomd, "sha256")}</hash>`,
    `    <hash type="sha512">${await hashFile(repomd, "sha512")}</hash>`,
    "   </verification>",
    '   <resources maxconnections="1">',
    `    <url protocol="https" type="https" preference="100">${repomdUrl}</url>`,
    "   </resources>",
    "  </file>",
    " </files>",
    "</metalink>",
    "",
  ].join("\n");
  await write(path.join(repository, "rpm", "release", architecture, "metalink.xml"), metalink);

  const keyUrl = `${packageBaseUrl}/keys/shift-repository.gpg`;
  const aptSource = [
    "Types: deb",
    `URIs: ${packageBaseUrl}/apt`,
    "Suites: release",
    "Components: main",
    "Architectures: amd64",
    "Signed-By: /etc/apt/keyrings/shift-repository.gpg",
    "",
  ].join("\n");
  const dnfRepository = [
    "[shift-release]",
    "name=Shift Release",
    `metalink=${packageBaseUrl}/rpm/release/$basearch/metalink.xml`,
    "enabled=1",
    "gpgcheck=1",
    "repo_gpgcheck=1",
    `gpgkey=${keyUrl}`,
    "metadata_expire=6h",
    "skip_if_unavailable=False",
    "",
  ].join("\n");
  await Promise.all([
    write(path.join(repository, "config", "shift.sources"), aptSource),
    write(path.join(repository, "config", "shift.repo"), dnfRepository),
  ]);
}

function validateVersion(version) {
  if (!versionPattern.test(version)) {
    throw new Error(`Expected a numeric three-component version, received: ${version}`);
  }
}

function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Linux package base URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Linux package base URL cannot contain credentials, a query, or a fragment");
  }
  return url.toString().replace(/\/$/, "");
}

function parsePublicationDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid publication date: ${value}`);
  return date;
}

async function prepareEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Linux repository output directory is not empty: ${directory}`);
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

function findArtifact(files, name) {
  const matches = files.filter((file) => path.basename(file) === name);
  if (matches.length !== 1) throw new Error(`Expected one ${name}, found ${matches.length}`);
  return matches[0];
}

async function requireFile(file) {
  const details = await stat(file);
  if (!details.isFile()) throw new Error(`Expected a file: ${file}`);
}

async function hashFile(file, algorithm) {
  return createHash(algorithm)
    .update(await readFile(file))
    .digest("hex");
}

async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function write(destination, contents) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "stage": {
      const [artifactsRoot, repositoryRoot, version] = args;
      if (!artifactsRoot || !repositoryRoot || !version) {
        throw new Error(
          "Usage: prepare-linux-repositories.mjs stage <artifacts> <repository> <version>",
        );
      }
      const staged = await stageLinuxPackages({ artifactsRoot, repositoryRoot, version });
      process.stdout.write(`${JSON.stringify(staged)}\n`);
      break;
    }
    case "finalize": {
      const [repositoryRoot, version, baseUrl, publishedAt] = args;
      if (!repositoryRoot || !version || !baseUrl) {
        throw new Error(
          "Usage: prepare-linux-repositories.mjs finalize <repository> <version> <base-url> [published-at]",
        );
      }
      await finalizeLinuxRepositories({ repositoryRoot, version, baseUrl, publishedAt });
      break;
    }
    default:
      throw new Error(`Expected stage or finalize command, received: ${command}`);
  }
}
