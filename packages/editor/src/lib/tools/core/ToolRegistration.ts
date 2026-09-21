import type { ToolManifest } from "./ToolManifest";
import type { ToolName } from "./createContext";

/** Owns one installed tool contribution until it is permanently removed. */
export class ToolRegistration {
  readonly id: ToolName;
  readonly #replaceRegistration: (manifest: ToolManifest) => void;
  readonly #disposeRegistration: () => void;
  #disposed = false;

  /** @internal Constructed only by the tool registry. */
  constructor(
    id: ToolName,
    replaceRegistration: (manifest: ToolManifest) => void,
    disposeRegistration: () => void,
  ) {
    this.id = id;
    this.#replaceRegistration = replaceRegistration;
    this.#disposeRegistration = disposeRegistration;
  }

  /**
   * Replaces the owned contribution while preserving its stable identity.
   *
   * @param manifest - New metadata and factory for this registration's tool ID.
   * @throws {Error} when the handle was disposed or the manifest changes identity.
   */
  replace(manifest: ToolManifest): void {
    if (this.#disposed) throw new Error(`Tool registration is disposed: ${this.id}`);
    if (manifest.id !== this.id) {
      throw new Error(`Tool registration cannot change id from ${this.id} to ${manifest.id}`);
    }

    this.#replaceRegistration(manifest);
  }

  /** Permanently removes the owned contribution; repeated disposal is harmless. */
  dispose(): void {
    if (this.#disposed) return;

    this.#disposeRegistration();
    this.#disposed = true;
  }
}
