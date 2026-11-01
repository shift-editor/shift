import { releaseScene, scenes } from "@shift/wasm";
import { signal, type Signal, type WritableSignal } from "../signals/index";
import type {
  SceneDocument,
  SceneIntent,
  RevisedNode,
  SceneRecording,
} from "../../types/sceneDocument";

const released = new FinalizationRegistry<number>(releaseScene);

/**
 * The scene of a session with no editing engine, such as a preview or an
 * in-memory session: shift-engine's scene, held in `@shift/wasm` alone.
 *
 * @remarks
 * Nothing is persisted, and the scene has no undo history: undo in such a
 * session covers its font edits and session state only.
 */
export class SessionScene implements SceneDocument {
  readonly #handle: number;
  readonly #revisionCell: WritableSignal<number> = signal(0, { name: "sessionScene.revision" });

  constructor() {
    this.#handle = scenes.openScene();
    released.register(this, this.#handle, this);
  }

  get revisionCell(): Signal<number> {
    return this.#revisionCell;
  }

  nodes(): readonly RevisedNode[] {
    return scenes.sceneNodes(this.#handle);
  }

  apply(intents: readonly SceneIntent[], _recording: SceneRecording): void {
    const refused = scenes.applyScene(this.#handle, intents);
    if (refused !== null) throw new Error(refused);

    this.#revisionCell.update((revision) => revision + 1);
  }

  followShownPage(): void {}

  /** A session scene has no undo history, so nothing replays. */
  followReplays(): void {}

  /** Releases the scene; reads afterwards find no nodes. */
  dispose(): void {
    released.unregister(this);
    releaseScene(this.#handle);
  }
}
