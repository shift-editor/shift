import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = path.join(repositoryRoot, "apps", "desktop");
const virtualDesktopRunner = path.join(repositoryRoot, "scripts", "run-with-virtual-desktop.mjs");
const requireFromRoot = createRequire(path.join(repositoryRoot, "package.json"));
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
const turboCli = requireFromRoot.resolve("turbo/bin/turbo");
const playwrightCli = requireFromDesktop.resolve("@playwright/test/cli");
const projectNames = new Set(["visual", "platform", "gpu", "perf"]);

try {
  const { projects, playwrightArguments } = parseArguments(process.argv.slice(2));
  console.info(`E2E projects for ${process.platform}: ${projects.join(", ")}`);

  const exitCode = await runProcess(
    process.execPath,
    [turboCli, "run", buildTask(projects), "--filter=@shift/desktop"],
    repositoryRoot,
  );
  process.exitCode = exitCode === 0 ? await runProjects(projects, playwrightArguments) : exitCode;
} catch (error) {
  console.error(`run-e2e: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  const explicitProject = projectNames.has(arguments_[0]) ? arguments_[0] : null;
  const playwrightArguments = explicitProject ? arguments_.slice(1) : arguments_;
  if (
    playwrightArguments.some(
      (argument) => argument === "--project" || argument.startsWith("--project="),
    )
  ) {
    throw new Error(
      "Select a project with `pnpm test:e2e:visual`, `:platform`, `:gpu`, or `:perf`.",
    );
  }

  return {
    projects: explicitProject ? [explicitProject] : defaultProjects(process.platform),
    playwrightArguments,
  };
}

function defaultProjects(platform) {
  switch (platform) {
    case "darwin":
      return ["visual", "platform", "gpu"];
    case "linux":
    case "win32":
      return ["platform"];
    default:
      throw new Error(`Unsupported E2E host platform: ${platform}`);
  }
}

/**
 * Perf measures the release addon; every other project runs the faster-to-build e2e profile.
 */
function buildTask(projects) {
  return projects.includes("perf") ? "build:perf" : "build:e2e";
}

/**
 * Runs each project as its own Playwright run, so a project's worker limit holds for the
 * whole run: in one run, platform's single worker would share the screen with visual's
 * parallel apps. A filter that matches none of one project's specs is not a failure when
 * several projects run. Later projects still run after a failure; the first failing code wins.
 */
async function runProjects(projects, playwrightArguments) {
  const projectArguments =
    projects.length > 1 ? ["--pass-with-no-tests", ...playwrightArguments] : playwrightArguments;
  let exitCode = 0;
  for (const project of projects) {
    const projectExitCode = await runPlaywright([project], projectArguments);
    if (exitCode === 0) exitCode = projectExitCode;
  }

  return exitCode;
}

async function runPlaywright(projects, playwrightArguments) {
  const requiresHardwareGpu = projects.some((project) => project === "gpu" || project === "perf");
  if (process.platform === "linux" && requiresHardwareGpu && !process.env.DISPLAY) {
    throw new Error(
      "GPU and performance E2E require an active Linux desktop and hardware GPU session.",
    );
  }

  const arguments_ = [
    playwrightCli,
    "test",
    ...projects.map((project) => `--project=${project}`),
    ...playwrightArguments,
  ];
  const requiresVirtualDesktop =
    process.platform === "linux" &&
    projects.every((project) => project === "visual" || project === "platform");

  if (requiresVirtualDesktop) {
    return await runProcess(
      process.execPath,
      [virtualDesktopRunner, "--", process.execPath, ...arguments_],
      desktopRoot,
    );
  }

  return await runProcess(process.execPath, arguments_, desktopRoot);
}

function runProcess(command, arguments_, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    const signalHandlers = new Map();

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => child.kill(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }

    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    };

    child.once("error", (error) => {
      removeSignalHandlers();
      reject(new Error(`Unable to start ${command}: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      resolve(code ?? signalExitCode(signal));
    });
  });
}

function signalExitCode(signal) {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}
