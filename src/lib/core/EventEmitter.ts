import { EditorEvent, EditorEventMap } from "@/types/events";

export type EventHandler<T> = (data: T) => void;

export class EventEmitter {
  #events: Map<EditorEvent, EventHandler<any>[]>;

  constructor() {
    this.#events = new Map();
  }

  on<E extends EditorEvent>(
    event: E,
    handler: EventHandler<EditorEventMap[E]>,
  ) {
    const handlers = this.#events.get(event) || [];
    handlers.push(handler as EventHandler<any>);
    this.#events.set(event, handlers);
  }

  emit<E extends EditorEvent>(event: E, data: EditorEventMap[E]) {
    const handlers = this.#events.get(event);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => handler(data));
  }

  off<E extends EditorEvent>(
    event: E,
    handler: EventHandler<EditorEventMap[E]>,
  ) {
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
