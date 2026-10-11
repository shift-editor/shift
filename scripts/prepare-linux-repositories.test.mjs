import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeLinuxRepositories, stageLinuxPackages } from "./prepare-linux-repositories.mjs";

const version = "0.2.3";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-linux-repository-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const artifactsRoot = path.join(root, "artifacts");
  const repositoryRoot = path.join(root, "repository");
  await mkdir(artifactsRoot, { recursive: true });
  await Promise.all(
    ["arm64", "x64"].flatMap((architecture) => [
      writeFile(
        path.join(artifactsRoot, `Shift-${version}-Linux-${architecture}.deb`),
        `deb-${architecture}`,
      ),
      writeFile(
        path.join(artifactsRoot, `Shift-${version}-Linux-${architecture}.rpm`),
        `rpm-${architecture}`,
      ),
      writeFile(
        path.join(artifactsRoot, `Shift-${version}-Linux-${architecture}.AppImage`),
        `appimage-${architecture}`,
      ),
    ]),
  );
  return { artifactsRoot, repositoryRoot };
}

test("stages a complete versioned Linux artifact set for each architecture", async (context) => {
  const { artifactsRoot, repositoryRoot } = await fixture(context);
  const staged = await stageLinuxPackages({ artifactsRoot, repositoryRoot, version });

  for (const [architecture, debian, rpm] of [
    ["x64", "amd64", "x86_64"],
    ["arm64", "arm64", "aarch64"],
  ]) {
    assert.equal(await readFile(staged[architecture].deb, "utf8"), `deb-${architecture}`);
    assert.equal(await readFile(staged[architecture].rpm, "utf8"), `rpm-${architecture}`);
    assert.equal(
      path.relative(repositoryRoot, staged[architecture].deb),
      `apt/pool/main/s/shift/shift_${version}_${debian}.deb`,
    );
    assert.equal(
      path.relative(repositoryRoot, staged[architecture].rpm),
      `rpm/releases/${version}/${rpm}/shift-${version}-1.${rpm}.rpm`,
    );
  }
});

test("rejects an incomplete Linux artifact set", async (context) => {
  const { artifactsRoot, repositoryRoot } = await fixture(context);
  await rm(path.join(artifactsRoot, `Shift-${version}-Linux-arm64.rpm`));

  await assert.rejects(
    stageLinuxPackages({ artifactsRoot, repositoryRoot, version }),
    /Expected one Shift-0\.2\.3-Linux-arm64\.rpm, found 0/,
  );
});

test("writes authenticated APT roots and an immutable DNF metalink", async (context) => {
  const { artifactsRoot, repositoryRoot } = await fixture(context);
  await stageLinuxPackages({ artifactsRoot, repositoryRoot, version });
  const aptBinary = path.join(repositoryRoot, "apt/dists/release/main/binary-amd64");
  for (const [debian, rpm] of [
    ["amd64", "x86_64"],
    ["arm64", "aarch64"],
  ]) {
    const binary = path.join(repositoryRoot, `apt/dists/release/main/binary-${debian}`);
    const repodata = path.join(repositoryRoot, `rpm/releases/${version}/${rpm}/repodata`);
    await mkdir(repodata, { recursive: true });
    await Promise.all([
      writeFile(path.join(binary, "Packages"), debian === "amd64" ? "apt-packages" : "arm64-list"),
      writeFile(path.join(binary, "Packages.gz"), `compressed-${debian}`),
      writeFile(path.join(repodata, "repomd.xml"), `<repomd>signed ${rpm}</repomd>`),
      writeFile(path.join(repodata, "repomd.xml.asc"), `signature-${rpm}`),
    ]);
  }

  await finalizeLinuxRepositories({
    repositoryRoot,
    version,
    baseUrl: "https://packages.shift.graphics/",
    publishedAt: "2026-08-25T12:00:00Z",
  });

  const release = await readFile(path.join(repositoryRoot, "apt/dists/release/Release"), "utf8");
  const packageDigest = createHash("sha256").update("apt-packages").digest("hex");
  assert.match(release, /Suite: release/);
  assert.match(release, /Acquire-By-Hash: yes/);
  assert.match(release, /Architectures: amd64 arm64/);
  assert.match(release, new RegExp(`${packageDigest} 12 main/binary-amd64/Packages`));
  const arm64Digest = createHash("sha256").update("arm64-list").digest("hex");
  assert.match(release, new RegExp(`${arm64Digest} 10 main/binary-arm64/Packages`));
  assert.equal(
    await readFile(path.join(aptBinary, "by-hash/SHA256", packageDigest), "utf8"),
    "apt-packages",
  );

  for (const rpm of ["x86_64", "aarch64"]) {
    const metalink = await readFile(
      path.join(repositoryRoot, `rpm/release/${rpm}/metalink.xml`),
      "utf8",
    );
    const repomdDigest = createHash("sha256")
      .update(`<repomd>signed ${rpm}</repomd>`)
      .digest("hex");
    assert.match(metalink, new RegExp(repomdDigest));
    assert.match(
      metalink,
      new RegExp(
        `https://packages\\.shift\\.graphics/rpm/releases/${version}/${rpm}/repodata/repomd\\.xml`,
      ),
    );
  }

  const aptSource = await readFile(path.join(repositoryRoot, "config/shift.sources"), "utf8");
  assert.match(aptSource, /Suites: release/);
  assert.match(aptSource, /Signed-By: \/etc\/apt\/keyrings\/shift-repository\.gpg/);
  assert.equal(
    aptSource,
    await readFile(
      new URL("../apps/desktop/resources/linux/shift.sources", import.meta.url),
      "utf8",
    ),
  );

  const dnfRepository = await readFile(path.join(repositoryRoot, "config/shift.repo"), "utf8");
  assert.match(dnfRepository, /^\[shift-release\]$/m);
  assert.match(dnfRepository, /gpgcheck=1/);
  assert.match(dnfRepository, /repo_gpgcheck=1/);
  assert.match(dnfRepository, /rpm\/release\/\$basearch\/metalink\.xml/);
});

test("rejects a non-HTTPS package origin", async (context) => {
  const { artifactsRoot, repositoryRoot } = await fixture(context);
  await stageLinuxPackages({ artifactsRoot, repositoryRoot, version });

  await assert.rejects(
    finalizeLinuxRepositories({
      repositoryRoot,
      version,
      baseUrl: "http://packages.shift.graphics",
    }),
    /must use HTTPS/,
  );
});
