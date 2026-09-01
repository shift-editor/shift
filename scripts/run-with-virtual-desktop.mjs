import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const defaultScreen = "1920x1080x24";
const activeEnvironmentVariable = "SHIFT_VIRTUAL_DESKTOP_ACTIVE";
const scriptPath = fileURLToPath(import.meta.url);

try {
  const { screen, command, commandArguments } = parseArguments(process.argv.slice(2));
  process.exitCode = await runWithVirtualDesktop(screen, command, commandArguments);
} catch (error) {
  console.error(
    `run-with-virtual-desktop: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function runWithVirtualDesktop(screen, command, commandArguments) {
  if (process.platform !== "linux") {
    return await runProcess(command, commandArguments);
  }

  if (process.env[activeEnvironmentVariable] === "1") {
    return await runInsideVirtualDesktop(command, commandArguments);
  }

  return await runProcess(
    "xvfb-run",
    [
      "--auto-servernum",
      `--server-args=-screen 0 ${screen}`,
      process.execPath,
      scriptPath,
      "--screen",
      screen,
      "--",
      command,
      ...commandArguments,
    ],
    {
      env: {
        ...process.env,
        [activeEnvironmentVariable]: "1",
      },
      missingCommandHelp: "Enter `nix develop` so Xvfb and Fluxbox are available.",
    },
  );
}

async function runInsideVirtualDesktop(command, commandArguments) {
  let fluxboxError = null;
  let fluxboxOutput = "";
  const fluxbox = spawn("fluxbox", [], {
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  fluxbox.once("error", (error) => {
    fluxboxError = error;
  });
  fluxbox.stderr?.on("data", (chunk) => {
    if (fluxboxOutput.length < 16_384) fluxboxOutput += chunk.toString();
  });

  await delay(1_000);

  if (fluxboxError) {
    throw new Error(
      `Unable to start Fluxbox: ${fluxboxError.message}. Enter \`nix develop\` so Xvfb and Fluxbox are available.`,
    );
  }
  if (fluxbox.exitCode !== null) {
    throw new Error(
      `Fluxbox exited during startup with code ${fluxbox.exitCode}.${formatOutput(fluxboxOutput)}`,
    );
  }

  try {
    return await runProcess(command, commandArguments);
  } finally {
    await stopProcess(fluxbox);
  }
}

function parseArguments(arguments_) {
  let screen = defaultScreen;
  let separatorIndex = -1;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      separatorIndex = index;
      break;
    }
    if (argument === "--screen") {
      screen = arguments_[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument.startsWith("--screen=")) {
      screen = argument.slice("--screen=".length);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (!/^\d+x\d+x\d+$/.test(screen)) {
    throw new Error(`Invalid screen specification: ${screen || "<empty>"}`);
  }
  if (separatorIndex === -1 || !arguments_[separatorIndex + 1]) {
    throw new Error(
      "Usage: run-with-virtual-desktop.mjs [--screen 1920x1080x24] -- <command> [args...]",
    );
  }

  return {
    screen,
    command: arguments_[separatorIndex + 1],
    commandArguments: arguments_.slice(separatorIndex + 2),
  };
}

function runProcess(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === "win32",
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
      const help = options.missingCommandHelp ? ` ${options.missingCommandHelp}` : "";
      reject(new Error(`Unable to start ${command}: ${error.message}.${help}`));
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      resolve(code ?? signalExitCode(signal));
    });
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, delay(1_000)]);
  if (child.exitCode !== null || child.signalCode !== null) return;

  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await Promise.race([killed, delay(1_000)]);
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

function formatOutput(output) {
  const trimmed = output.trim();
  return trimmed ? `\n${trimmed}` : "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
