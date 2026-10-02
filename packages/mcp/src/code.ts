import RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import type { ShiftCapabilities } from "@shift/runtime";

const EXECUTION_TIMEOUT_MS = 3_000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_CODE_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
let quickJsPromise: Promise<QuickJSWASMModule> | null = null;

/** Executes agent-written JavaScript against only the supplied Shift capabilities. */
export async function executeShiftCode(
  capabilities: ShiftCapabilities,
  code: string,
): Promise<unknown> {
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    throw new Error(`shift.execute code exceeds ${MAX_CODE_BYTES} bytes`);
  }

  const QuickJS = await loadQuickJS();
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

  const vm = runtime.newContext();
  installAsyncJsonFunction(vm, "__shiftListSessions", deadline, () => capabilities.sessions.list());
  installAsyncJsonFunction(vm, "__shiftInspectEditor", deadline, (windowId) => {
    if (typeof windowId !== "number" || !Number.isInteger(windowId)) {
      throw new Error("editor.inspect requires an integer windowId");
    }

    return capabilities.editor.inspect({ windowId });
  });

  const bootstrap = `
    "use strict";
    const shift = Object.freeze({
      sessions: Object.freeze({
        list: async () => JSON.parse(await __shiftListSessions()),
      }),
      editor: Object.freeze({
        inspect: async ({ windowId }) => JSON.parse(await __shiftInspectEditor(windowId)),
      }),
    });
    (async () => {
      const entry = (${code});
      if (typeof entry !== "function") throw new Error("shift.execute code must evaluate to a function");
      const result = await entry();
      const json = JSON.stringify(result);
      if (json === undefined) throw new Error("shift.execute must return a JSON value");
      return json;
    })();
  `;

  try {
    const evaluation = vm.evalCode(bootstrap, "shift-agent.js");
    const promiseHandle = vm.unwrapResult(evaluation);
    const settledPromise = vm.resolvePromise(promiseHandle);
    vm.runtime.executePendingJobs();

    let settled: Awaited<typeof settledPromise>;
    try {
      settled = await withDeadline(settledPromise, deadline);
    } finally {
      promiseHandle.dispose();
    }

    const resultHandle = vm.unwrapResult(settled);
    const json = vm.getString(resultHandle);
    resultHandle.dispose();

    if (Buffer.byteLength(json, "utf8") > MAX_RESULT_BYTES) {
      throw new Error(`shift.execute result exceeds ${MAX_RESULT_BYTES} bytes`);
    }

    return JSON.parse(json) as unknown;
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

function loadQuickJS(): Promise<QuickJSWASMModule> {
  quickJsPromise ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
  return quickJsPromise;
}

function installAsyncJsonFunction(
  vm: QuickJSContext,
  name: string,
  deadline: number,
  call: (...args: unknown[]) => unknown | Promise<unknown>,
): void {
  const functionHandle = vm.newFunction(name, (...argumentHandles) => {
    const args = argumentHandles.map((handle) => vm.dump(handle));
    const promise = vm.newPromise();

    try {
      const result = call(...args);
      withDeadline(Promise.resolve(result), deadline).then(
        (value) => {
          const resultHandle = vm.newString(JSON.stringify(value));
          promise.resolve(resultHandle);
          resultHandle.dispose();
        },
        (error) => {
          const errorHandle = vm.newError(errorMessage(error));
          promise.reject(errorHandle);
          errorHandle.dispose();
        },
      );
    } catch (error) {
      const errorHandle = vm.newError(errorMessage(error));
      promise.reject(errorHandle);
      errorHandle.dispose();
    }

    void promise.settled.then(() => vm.runtime.executePendingJobs());
    return promise.handle;
  });

  functionHandle.consume((handle) => vm.setProp(vm.global, name, handle));
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const timeoutMs = Math.max(0, deadline - Date.now());
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("shift.execute timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
