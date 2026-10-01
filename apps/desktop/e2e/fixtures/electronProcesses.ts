import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import { execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ElectronLaunch } from "./types";
import { collectWindowDiagnostics, prepareWindow } from "./window";

const APP_ROOT = path.resolve(__dirname, "../..");
export const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");

const MAX_DIAGNOSTIC_LINES = 500;
const execFileAsync = promisify(execFile);

interface RegisteredLaunch {
  readonly label: string;
  readonly app: ElectronApplication;
  readonly process: ChildProcess;
  readonly diagnostics: string[];
}

/**
 * Owns every Electron process a test launches.
 *
 * @remarks
 * Each launch records main-process output and renderer failures. Teardown attaches that
 * evidence when the test fails and terminates every process tree, including launches whose
 * test body timed out before it could clean up. Specs therefore never kill applications they
 * obtained from a fixture.
 */
export class ElectronProcesses {
  readonly #launches: RegisteredLaunch[] = [];

  /**
   * Launches the application, verifies its isolated user data, and prepares the first window.
   *
   * @param launch - arguments, environment, and window policy for this process.
   * @returns the running application, owned until {@link terminateAll}.
   * @throws {Error} with window diagnostics when the application ignores its user-data
   *   directory or its first window never becomes ready.
   */
  async launch(launch: ElectronLaunch): Promise<ElectronApplication> {
    const app = await electron.launch({
      args: [
        MAIN_JS,
        `--user-data-dir=${launch.userDataDir}`,
        `--force-device-scale-factor=${launch.deviceScaleFactor ?? 1}`,
        ...(launch.args ?? []),
      ],
      env: launch.env,
    });
    const registered: RegisteredLaunch = {
      label: launch.label,
      app,
      process: app.process(),
      diagnostics: [],
    };
    this.#launches.push(registered);
    observe(registered);

    try {
      const page = await app.firstWindow();
      const activeUserDataDir = await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath("userData"),
      );
      if (fs.realpathSync(activeUserDataDir) !== fs.realpathSync(launch.userDataDir)) {
        throw new Error(`Electron ignored isolated user data directory: ${activeUserDataDir}`);
      }

      await prepareWindow(app, page, launch.windowSizing);
      return app;
    } catch (error) {
      const diagnostics = await collectWindowDiagnostics(app);
      throw new Error(`Electron ${launch.label} launch failed:\n${diagnostics.join("\n")}`, {
        cause: error,
      });
    }
  }

  /**
   * Attaches recorded evidence for every launch; call only for failed tests.
   * @param testInfo - failing test that receives one attachment per launch.
   */
  async attachDiagnostics(testInfo: TestInfo): Promise<void> {
    for (const launch of this.#launches) {
      const lines = [...launch.diagnostics];
      if (launch.process.exitCode === null && launch.process.signalCode === null) {
        lines.push(...(await collectWindowDiagnostics(launch.app)));
      }

      await testInfo.attach(`electron-diagnostics-${launch.label}`, {
        body: lines.join("\n"),
        contentType: "text/plain",
      });
    }
  }

  /** Terminates every launched process tree that is still running. */
  async terminateAll(): Promise<void> {
    const failures: unknown[] = [];
    for (const launch of this.#launches) {
      try {
        await terminateProcessTree(launch.process);
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to terminate Electron test processes");
    }
  }
}

function observe(launch: RegisteredLaunch): void {
  const record = (message: string) => {
    launch.diagnostics.push(`${new Date().toISOString()} ${message}`);
    if (launch.diagnostics.length > MAX_DIAGNOSTIC_LINES) launch.diagnostics.shift();
  };

  launch.process.once("exit", (code, signal) => {
    record(`Electron exited: code=${code ?? "null"}, signal=${signal ?? "null"}`);
  });
  launch.process.stdout?.on("data", (data) => record(`main stdout: ${String(data).trim()}`));
  launch.process.stderr?.on("data", (data) => record(`main stderr: ${String(data).trim()}`));

  const observePage = (page: Page) => {
    record(`window opened: ${page.url()}`);
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        record(`renderer ${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => record(`renderer error: ${error.stack}`));
    page.on("crash", () => record(`renderer crashed: ${page.url()}`));
    page.on("close", () => record(`window closed: ${page.url()}`));
  };
  for (const page of launch.app.windows()) observePage(page);
  launch.app.on("window", observePage);
}

/**
 * Force-terminates the application and all descendant processes.
 *
 * @param app - application whose process tree must release test resources.
 * @throws {Error} when the platform termination command cannot stop a running application.
 */
export async function killApp(app: ElectronApplication): Promise<void> {
  await terminateProcessTree(app.process());
}

/**
 * Terminates an Electron process tree through a handle that survives Playwright disconnection.
 *
 * @remarks
 * Playwright starts Electron through a shell on Windows, so the recorded PID can be a wrapper;
 * `taskkill /T` removes the Electron descendants that would otherwise hold file locks.
 */
async function terminateProcessTree(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  if (process.platform === "win32") {
    const pid = childProcess.pid;
    if (pid === undefined) throw new Error("Electron process has no PID");

    try {
      await execFileAsync("taskkill", ["/F", "/PID", String(pid), "/T"]);
    } catch (error) {
      if (childProcess.exitCode === null && childProcess.signalCode === null) throw error;
    }
  } else {
    childProcess.kill("SIGKILL");
  }

  await exited;
}
