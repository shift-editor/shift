import RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { shiftInputSchemas, type ShiftCapabilities } from "@shift/runtime";

const EXECUTION_TIMEOUT_MS = 3_000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_CODE_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
let quickJsPromise: Promise<QuickJSWASMModule> | null = null;

/**
 * Executes one-shot JavaScript against only the supplied Shift capabilities.
 *
 * @param capabilities - Host-owned operations exposed as `shift` in a fresh realm.
 * @param code - Async zero-argument function source with a bounded size.
 * @returns the JSON-compatible result; no realm state survives the call.
 * @throws {Error} when execution fails, times out, or exceeds its resource limits.
 */
export async function executeShiftCode(
  capabilities: ShiftCapabilities,
  code: string,
): Promise<unknown> {
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    throw new Error(`Shift script exceeds ${MAX_CODE_BYTES} bytes`);
  }

  const QuickJS = await loadQuickJS();
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

  const vm = runtime.newContext();
  installAsyncJsonFunction(vm, "__shiftCapture", deadline, (input) =>
    capabilities.capture(shiftInputSchemas.capture.parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftListSessions", deadline, () => capabilities.sessions.list());
  installAsyncJsonFunction(vm, "__shiftInspectEditor", deadline, (input) =>
    capabilities.editor.inspect(shiftInputSchemas["editor.inspect"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftGetFont", deadline, (input) =>
    capabilities.font.get(shiftInputSchemas["font.get"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftResolveLocation", deadline, (input) =>
    capabilities.locations.resolve(shiftInputSchemas["locations.resolve"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftListGlyphs", deadline, (input) =>
    capabilities.glyphs.list(shiftInputSchemas["glyphs.list"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftGetGlyph", deadline, (input) =>
    capabilities.glyphs.get(shiftInputSchemas["glyphs.get"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftResolveGlyphs", deadline, (input) =>
    capabilities.glyphs.resolve(shiftInputSchemas["glyphs.resolve"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftGetLayer", deadline, (input) =>
    capabilities.layers.get(shiftInputSchemas["layers.get"].parse(input)),
  );
  installAsyncJsonFunction(vm, "__shiftRenderLayer", deadline, (input) =>
    capabilities.layers.render(shiftInputSchemas["layers.render"].parse(input)),
  );

  const bootstrap = `
    "use strict";
    const shift = Object.freeze({
      capture: async (input) => JSON.parse(await __shiftCapture(input)),
      sessions: Object.freeze({
        list: async () => JSON.parse(await __shiftListSessions()),
      }),
      editor: Object.freeze({
        inspect: async (input) => JSON.parse(await __shiftInspectEditor(input)),
      }),
      font: Object.freeze({
        get: async (input) => JSON.parse(await __shiftGetFont(input)),
      }),
      locations: Object.freeze({
        resolve: async (input) => JSON.parse(await __shiftResolveLocation(input)),
      }),
      glyphs: Object.freeze({
        list: async (input) => JSON.parse(await __shiftListGlyphs(input)),
        get: async (input) => JSON.parse(await __shiftGetGlyph(input)),
        resolve: async (input) => JSON.parse(await __shiftResolveGlyphs(input)),
      }),
      layers: Object.freeze({
        get: async (input) => JSON.parse(await __shiftGetLayer(input)),
        render: async (input) => JSON.parse(await __shiftRenderLayer(input)),
      }),
    });
    (async () => {
      const entry = (${code});
      if (typeof entry !== "function") throw new Error("Shift script must evaluate to a function");
      const result = await entry();
      const json = JSON.stringify(result);
      if (json === undefined) throw new Error("Shift script must return a JSON value");
      return json;
    })();
  `;

  try {
    const evaluation = vm.evalCode(bootstrap, "shift-script.js");
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
      throw new Error(`Shift script result exceeds ${MAX_RESULT_BYTES} bytes`);
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
    timeout = setTimeout(() => reject(new Error("Shift script timed out")), timeoutMs);
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
