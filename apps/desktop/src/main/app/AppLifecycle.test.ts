import { EventEmitter } from "node:events";
import { app, autoUpdater } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";
import { AppLifecycle, type CloseConfirmation } from "./AppLifecycle";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class TestApp extends EventEmitter {
    quitCount = 0;

    quit(): void {
      this.quitCount += 1;
    }
  }
  return { app: new TestApp(), autoUpdater: new EventEmitter() };
});

const testApp = app as unknown as EventEmitter & { quitCount: number };
const testUpdater = autoUpdater as unknown as EventEmitter;
const log = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ShiftLogger;

function createLifecycle(commitError: Error | null = null) {
  const documentState = { pending: false, committed: false, canceled: false };
  const document: CloseConfirmation = {
    shouldConfirmClose: () => true,
    confirmClose: async () => {
      documentState.pending = true;
      return true;
    },
    commitExit: async () => {
      if (commitError) throw commitError;
      documentState.pending = false;
      documentState.committed = true;
    },
    cancelExit: () => {
      documentState.pending = false;
      documentState.canceled = true;
    },
  };
  const lifecycle = new AppLifecycle({
    documentForWindow: () => null,
    documents: () => [document],
    log,
  });
  return { lifecycle, documentState };
}

function quitEvent() {
  const state = { prevented: false };
  return {
    state,
    event: {
      preventDefault: () => {
        state.prevented = true;
      },
    },
  };
}

describe("AppLifecycle exit finalization", () => {
  afterEach(() => {
    testApp.removeAllListeners();
    testApp.quitCount = 0;
    testUpdater.removeAllListeners();
  });

  it("commits deferred documents before allowing process exit", async () => {
    const { lifecycle, documentState } = createLifecycle();
    const windowEvents = Object.assign(new EventEmitter(), { id: 1 });
    lifecycle.registerWindow({ window: windowEvents } as unknown as Window, {
      onClosed: () => undefined,
    });
    lifecycle.start();
    expect(await lifecycle.confirmQuit("update")).toBe(true);
    testUpdater.emit("before-quit-for-update");

    expect(lifecycle.resetQuitConfirmation()).toBe(false);
    await vi.waitFor(() => {
      expect(documentState.committed).toBe(true);
      expect(testApp.quitCount).toBe(1);
    });

    const final = quitEvent();
    testApp.emit("before-quit", final.event);
    expect(final.state.prevented).toBe(false);
    const close = quitEvent();
    windowEvents.emit("close", close.event);
    expect(close.state.prevented).toBe(false);
  });

  it("finishes process exit after a document cleanup error", async () => {
    const { lifecycle } = createLifecycle(new Error("cleanup failed"));
    lifecycle.start();
    expect(await lifecycle.confirmQuit("update")).toBe(true);

    testUpdater.emit("before-quit-for-update");
    await vi.waitFor(() => expect(testApp.quitCount).toBe(1));
    expect(lifecycle.resetQuitConfirmation()).toBe(false);
  });

  it("cancels deferred cleanup when exit fails before finalization", async () => {
    const { lifecycle, documentState } = createLifecycle();
    expect(await lifecycle.confirmQuit("update")).toBe(true);

    expect(lifecycle.resetQuitConfirmation()).toBe(true);
    expect(documentState).toEqual({ pending: false, committed: false, canceled: true });
  });
});
