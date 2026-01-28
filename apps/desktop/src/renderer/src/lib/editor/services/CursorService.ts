import type { CursorType } from "@/types/editor";
import type { Signal } from "@/lib/reactive/signal";

export class CursorService {
  #signal: Signal<string>;
  #setCursor: (cursor: CursorType) => void;

  constructor(signal: Signal<string>, setCursor: (cursor: CursorType) => void) {
    this.#signal = signal;
    this.#setCursor = setCursor;
  }

  get(): string {
    return this.#signal.value;
  }

  set(cursor: CursorType): void {
    this.#setCursor(cursor);
  }
}
