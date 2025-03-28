import { emit, listen, UnlistenFn } from '@tauri-apps/api/event';

import { EventHandler, EventName, IEventEmitter } from '@/types/events';

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

export class TauriEventEmitter implements IEventEmitter {
  #unlistenFns: Map<EventName, UnlistenFn[]>;

  constructor() {
    this.#unlistenFns = new Map();
  }

  on<T>(event: EventName, handler: EventHandler<T>) {
    listen<T>(event, (event) => {
      handler(event.payload);
    }).then((unlistenFn) => {
      this.#unlistenFns.set(event, [...(this.#unlistenFns.get(event) || []), unlistenFn]);
    });
  }

  emit<T>(event: EventName, data: T) {
    emit(event, data);
  }

  off(event: EventName) {
    const unlistenFns = this.#unlistenFns.get(event);

    if (!unlistenFns) {
      return;
    }

    unlistenFns.forEach((unlistenFn) => unlistenFn());
    this.#unlistenFns.delete(event);
  }
}
