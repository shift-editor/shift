import RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { ShiftReadScope, shiftInputSchemas, type ShiftCapabilities } from "@shift/runtime";

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
  const validated = validatedCapabilities(capabilities);
  const scopes = new Map<number, ShiftReadScope>();
  installAsyncJsonFunction(vm, "__shiftCapture", deadline, (input) =>
    validated.capture(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftListSessions", deadline, () => validated.sessions.list());
  installAsyncJsonFunction(vm, "__shiftInspectEditor", deadline, (input) =>
    validated.editor.inspect(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftGetFont", deadline, (input) =>
    validated.font.get(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftResolveLocation", deadline, (input) =>
    validated.locations.resolve(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftListGlyphs", deadline, (input) =>
    validated.glyphs.list(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftGetGlyph", deadline, (input) =>
    validated.glyphs.get(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftResolveGlyphs", deadline, (input) =>
    validated.glyphs.resolve(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftGetLayer", deadline, (input) =>
    validated.layers.get(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftResolveLayer", deadline, (input) =>
    validated.layers.resolve(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftRenderLayer", deadline, (input) =>
    validated.layers.render(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftKerningGroups", deadline, (input) =>
    validated.kerning.groups(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftKerningPairs", deadline, (input) =>
    validated.kerning.pairs(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftResolveKerning", deadline, (input) =>
    validated.kerning.resolve(input as never),
  );
  installAsyncJsonFunction(vm, "__shiftReadOpen", deadline, async (target) => {
    const scope = await ShiftReadScope.open(validated, shiftInputSchemas.read.parse(target));
    const scopeId = scopes.size + 1;
    scopes.set(scopeId, scope);
    return { scopeId, fontRevision: scope.fontRevision };
  });
  installAsyncJsonFunction(vm, "__shiftReadCall", deadline, (scopeId, method, input) =>
    callReadScope(requireScope(scopes, scopeId), method, input),
  );
  installSyncFunction(vm, "__shiftReadState", (scopeId) => requireScope(scopes, scopeId).state);
  installSyncFunction(vm, "__shiftReadClose", (scopeId) => {
    requireScope(scopes, scopeId).close();
    return "closed";
  });

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
        resolve: async (input) => JSON.parse(await __shiftResolveLayer(input)),
        render: async (input) => JSON.parse(await __shiftRenderLayer(input)),
      }),
      kerning: Object.freeze({
        groups: async (input) => JSON.parse(await __shiftKerningGroups(input)),
        pairs: async (input) => JSON.parse(await __shiftKerningPairs(input)),
        resolve: async (input) => JSON.parse(await __shiftResolveKerning(input)),
      }),
      read: async (target, callback) => {
        if (typeof callback !== "function") throw new TypeError("shift.read requires a callback");
        const { scopeId, fontRevision } = JSON.parse(await __shiftReadOpen(target));
        const call = (method) => async (input) =>
          JSON.parse(await __shiftReadCall(scopeId, method, input));
        const read = Object.freeze({
          get state() {
            return __shiftReadState(scopeId);
          },
          fontRevision,
          font: Object.freeze({ get: call("font.get") }),
          locations: Object.freeze({ resolve: call("locations.resolve") }),
          glyphs: Object.freeze({
            list: call("glyphs.list"),
            get: call("glyphs.get"),
            resolve: call("glyphs.resolve"),
          }),
          layers: Object.freeze({
            get: call("layers.get"),
            resolve: call("layers.resolve"),
            render: call("layers.render"),
          }),
          kerning: Object.freeze({
            groups: call("kerning.groups"),
            pairs: call("kerning.pairs"),
            resolve: call("kerning.resolve"),
          }),
        });
        try {
          return await callback(read);
        } finally {
          __shiftReadClose(scopeId);
        }
      },
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
    for (const scope of scopes.values()) scope.close();
    vm.dispose();
    runtime.dispose();
  }
}

/** Parses every untrusted input before it reaches a host capability. */
function validatedCapabilities(capabilities: ShiftCapabilities): ShiftCapabilities {
  return {
    capture: (input) => capabilities.capture(shiftInputSchemas.capture.parse(input)),
    sessions: { list: () => capabilities.sessions.list() },
    editor: {
      inspect: (input) =>
        capabilities.editor.inspect(shiftInputSchemas["editor.inspect"].parse(input)),
    },
    font: { get: (input) => capabilities.font.get(shiftInputSchemas["font.get"].parse(input)) },
    locations: {
      resolve: (input) =>
        capabilities.locations.resolve(shiftInputSchemas["locations.resolve"].parse(input)),
    },
    glyphs: {
      list: (input) => capabilities.glyphs.list(shiftInputSchemas["glyphs.list"].parse(input)),
      get: (input) => capabilities.glyphs.get(shiftInputSchemas["glyphs.get"].parse(input)),
      resolve: (input) =>
        capabilities.glyphs.resolve(shiftInputSchemas["glyphs.resolve"].parse(input)),
    },
    layers: {
      get: (input) => capabilities.layers.get(shiftInputSchemas["layers.get"].parse(input)),
      resolve: (input) =>
        capabilities.layers.resolve(shiftInputSchemas["layers.resolve"].parse(input)),
      render: (input) =>
        capabilities.layers.render(shiftInputSchemas["layers.render"].parse(input)),
    },
    kerning: {
      groups: (input) =>
        capabilities.kerning.groups(shiftInputSchemas["kerning.groups"].parse(input)),
      pairs: (input) => capabilities.kerning.pairs(shiftInputSchemas["kerning.pairs"].parse(input)),
      resolve: (input) =>
        capabilities.kerning.resolve(shiftInputSchemas["kerning.resolve"].parse(input)),
    },
  };
}

function requireScope(
  scopes: ReadonlyMap<number, ShiftReadScope>,
  scopeId: unknown,
): ShiftReadScope {
  const scope = typeof scopeId === "number" ? scopes.get(scopeId) : undefined;
  if (!scope) throw new Error("Unknown shift.read scope");
  return scope;
}

function callReadScope(scope: ShiftReadScope, method: unknown, input: unknown): Promise<unknown> {
  const args = input as never;
  switch (method) {
    case "font.get":
      return scope.font.get();
    case "locations.resolve":
      return scope.locations.resolve(args);
    case "glyphs.list":
      return scope.glyphs.list(args);
    case "glyphs.get":
      return scope.glyphs.get(args);
    case "glyphs.resolve":
      return scope.glyphs.resolve(args);
    case "layers.get":
      return scope.layers.get(args);
    case "layers.resolve":
      return scope.layers.resolve(args);
    case "layers.render":
      return scope.layers.render(args);
    case "kerning.groups":
      return scope.kerning.groups(args);
    case "kerning.pairs":
      return scope.kerning.pairs(args);
    case "kerning.resolve":
      return scope.kerning.resolve(args);
    default:
      throw new Error(`Unknown shift.read method: ${String(method)}`);
  }
}

function installSyncFunction(
  vm: QuickJSContext,
  name: string,
  call: (...args: unknown[]) => string,
): void {
  const functionHandle = vm.newFunction(name, (...argumentHandles) => {
    try {
      return vm.newString(call(...argumentHandles.map((handle) => vm.dump(handle))));
    } catch (error) {
      return { error: newVmError(vm, error) };
    }
  });

  functionHandle.consume((handle) => vm.setProp(vm.global, name, handle));
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
          const errorHandle = newVmError(vm, error);
          promise.reject(errorHandle);
          errorHandle.dispose();
        },
      );
    } catch (error) {
      const errorHandle = newVmError(vm, error);
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

/** Preserves the error name so scripts can recognize `FontChangedError`. */
function newVmError(vm: QuickJSContext, error: unknown) {
  return error instanceof Error
    ? vm.newError({ name: error.name, message: error.message })
    : vm.newError(String(error));
}
