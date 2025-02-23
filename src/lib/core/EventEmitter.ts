import { Event, EventData, EventHandler } from "@/types/events";

export class EventEmitter {
  #eventHandlers: Map<Event, EventHandler<Event>[]>;

  constructor() {
    this.#eventHandlers = new Map();
  }

  on<E extends Event>(event: E, handler: EventHandler) {
    const handlers = this.#eventHandlers.get(event) || [];
    handlers.push(handler);
    this.#eventHandlers.set(event, handlers);
  }

  emit<E extends Event>(event: E, data: EventData[E]) {
    const handlers = this.#eventHandlers.get(event);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => handler(data));
  }

  off<E extends Event>(event: E, handler: EventHandler<E>) {
    const handlers = this.#eventHandlers.get(event);

    if (!handlers) {
      return;
    }

    this.#eventHandlers.set(
      event,
      handlers.filter((h) => h !== handler),
    );
  }
}
