import { EditorEvent } from "@/types/events";

export type EventHandler = (...args: unknown[]) => void;

export class EventEmitter {
  #events: Map<EditorEvent, EventHandler[]>;

  constructor() {
    this.#events = new Map();
  }

  on(event: EditorEvent, handler: EventHandler) {
    this.#events.set(event, [...(this.#events.get(event) || []), handler]);
  }

  emit(event: EditorEvent, ...args: unknown[]) {
    const handlers = this.#events.get(event);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => handler(...args));
  }

  off(event: EditorEvent, handler: EventHandler) {
    const handlers = this.#events.get(event);

    if (!handlers) {
      return;
    }

    this.#events.set(
      event,
      handlers.filter((h) => h !== handler),
    );
  }
}
