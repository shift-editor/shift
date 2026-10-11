import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
// Contributor skills live in .agents/skills; user-facing skills that ship with the
// app live in skills/. Both are mirrored so contributors use the same user skill.
const SOURCES = [".agents/skills", "skills"];
const TARGETS = [".claude/skills", ".codex/skills"];
const CHECK = process.argv.includes("--check");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function filesUnder(dir) {
  if (!(await exists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function digest(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function dirsMatch(sourceDir, targetDir) {
  const sourceFiles = await filesUnder(sourceDir);
  const targetFiles = await filesUnder(targetDir);
  const relativeSourceFiles = sourceFiles.map((file) => path.relative(sourceDir, file)).sort();
  const relativeTargetFiles = targetFiles.map((file) => path.relative(targetDir, file)).sort();

  if (relativeSourceFiles.length !== relativeTargetFiles.length) return false;

  for (let index = 0; index < relativeSourceFiles.length; index++) {
    const relativePath = relativeSourceFiles[index];
    if (relativePath !== relativeTargetFiles[index]) return false;

    const sourceDigest = await digest(path.join(sourceDir, relativePath));
    const targetDigest = await digest(path.join(targetDir, relativePath));
    if (sourceDigest !== targetDigest) return false;
  }

  return true;
}

async function syncSkill(source, skillName) {
  const sourceDir = path.join(ROOT, source, skillName);
  for (const targetRoot of TARGETS) {
    const targetDir = path.join(ROOT, targetRoot, skillName);

    if (CHECK) {
      if (!(await dirsMatch(sourceDir, targetDir))) {
        console.error(`${targetRoot}/${skillName} is out of sync with ${source}/${skillName}`);
        process.exitCode = 1;
      }
      continue;
    }

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
  }
}

async function main() {
  const owners = new Map();
  for (const source of SOURCES) {
    const sourceRoot = path.join(ROOT, source);
    if (!(await exists(sourceRoot))) continue;

    const entries = await readdir(sourceRoot, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const owner = owners.get(entry.name);
      if (owner) throw new Error(`Skill "${entry.name}" exists in both ${owner} and ${source}`);
      owners.set(entry.name, source);
    }
  }

  for (const [skillName, source] of owners) {
    await syncSkill(source, skillName);
  }

  if (!CHECK) {
    console.log(`Synced ${owners.size} agent skill(s) to ${TARGETS.join(", ")}`);
  }
}

await main();
