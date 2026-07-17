import { describe, expect, it } from "vitest";
import type { ShiftLogger } from "../logging";
import { WorkspaceProcess } from "./WorkspaceProcess";

const silentLogger: ShiftLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("WorkspaceProcess close lifecycle", () => {
  it("treats a stopped process as an already closed workspace", async () => {
    const process = new WorkspaceProcess(silentLogger);

    await expect(process.closeWorkspace(true)).resolves.toBeNull();
  });
});
