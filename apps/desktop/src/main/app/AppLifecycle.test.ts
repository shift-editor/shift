import { describe, expect, it } from "vitest";
import type { ShiftLogger } from "../logging";
import { AppLifecycle, type CloseConfirmation } from "./AppLifecycle";

const silentLogger: ShiftLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("AppLifecycle document close authorization", () => {
  it("rejects quit confirmation after a workspace close failure", async () => {
    let closeFails = true;
    const document: CloseConfirmation = {
      shouldConfirmClose: () => true,
      prepareClose: async () => true,
      commitClose: async () => {
        if (closeFails) throw new Error("close failed");
      },
      cancelClose() {},
    };
    const lifecycle = new AppLifecycle({
      documentForWindow: () => null,
      documents: () => [document],
      log: silentLogger,
    });

    await expect(lifecycle.confirmQuit("update")).rejects.toThrow(
      "One or more documents could not be closed",
    );
    closeFails = false;

    await expect(lifecycle.confirmQuit("update")).resolves.toBe(true);
  });

  it("awaits every attempted close before rejecting authorization", async () => {
    let secondClosed = false;
    const failed: CloseConfirmation = {
      shouldConfirmClose: () => true,
      prepareClose: async () => true,
      commitClose: async () => Promise.reject(new Error("close failed")),
      cancelClose() {},
    };
    const completed: CloseConfirmation = {
      shouldConfirmClose: () => true,
      prepareClose: async () => true,
      commitClose: async () => {
        await Promise.resolve();
        secondClosed = true;
      },
      cancelClose() {},
    };
    const lifecycle = new AppLifecycle({
      documentForWindow: () => null,
      documents: () => [failed, completed],
      log: silentLogger,
    });

    await expect(lifecycle.confirmQuit("quit")).rejects.toThrow(
      "One or more documents could not be closed",
    );

    expect(secondClosed).toBe(true);
  });
});
