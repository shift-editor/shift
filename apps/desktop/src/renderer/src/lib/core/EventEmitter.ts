import type { EditorEventName, EditorEventMap, EventHandler, IEventEmitter } from '@/types/events';

export class EventEmitter implements IEventEmitter {
  #eventHandlers: Map<EditorEventName, EventHandler<any>[]>;

  constructor() {
    this.#eventHandlers = new Map();
  }

  on<K extends EditorEventName>(event: K, handler: EventHandler<K>) {
    const handlers = this.#eventHandlers.get(event) || [];
    handlers.push(handler as EventHandler<any>);
    this.#eventHandlers.set(event, handlers);
  }

  emit<K extends EditorEventName>(event: K, data: EditorEventMap[K]) {
    const handlers = this.#eventHandlers.get(event);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => handler(data));
  }

  off<K extends EditorEventName>(event: K, handler: EventHandler<K>) {
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
