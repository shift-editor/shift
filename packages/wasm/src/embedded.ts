// `atob` and `WebAssembly` are typed by the DOM library; declaring it here lets
// a consumer without it, such as a test in a DOM-free package, typecheck this.
/// <reference lib="dom" />

/** Compiles a module embedded as base64, synchronously. */
export function embeddedModule(base64: string): WebAssembly.Module {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new WebAssembly.Module(bytes);
}
