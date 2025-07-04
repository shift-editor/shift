import type { EventHandler, EventName, IEventEmitter } from "@/types/events";

export class EventEmitter implements IEventEmitter {
  #eventHandlers: Map<EventName, EventHandler<any>[]>;

  constructor() {
    this.#eventHandlers = new Map();
  }

  on<T>(event: EventName, handler: EventHandler<T>) {
    const handlers = this.#eventHandlers.get(event) || [];
    handlers.push(handler);
    this.#eventHandlers.set(event, handlers);
  }

  emit<T>(event: EventName, data: T) {
    const handlers = this.#eventHandlers.get(event);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => handler(data));
  }

  off<T>(event: EventName, handler: EventHandler<T>) {
    const handlers = this.#eventHandlers.get(event);

    if (!handlers) {
      return;
    }

    this.#eventHandlers.set(
      event,
      handlers.filter((h) => h !== handler)
    );
  }
}
