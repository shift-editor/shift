import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EventEmitter } from '@/lib/core/EventEmitter';

import { EntityId } from './EntityId';

describe('EventEmitter', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('should emit events', () => {
    const handler = vi.fn();

    emitter.on('points:added', handler);

    emitter.emit('points:added', [new EntityId(1)]);

    expect(handler).toHaveBeenCalled();
  });

  it('should call multiple handlers', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('points:added', handler1);
    emitter.on('points:added', handler2);

    const pointId = new EntityId(1);

    emitter.emit('points:added', [pointId]);

    expect(handler1).toHaveBeenCalledWith([pointId]);
    expect(handler2).toHaveBeenCalledWith([pointId]);
  });

  it('should remove event handlers', () => {
    const handler = vi.fn();

    emitter.on('points:added', handler);
    emitter.off('points:added', handler);

    emitter.emit('points:added', [new EntityId(1)]);

    expect(handler).not.toHaveBeenCalled();
  });
});
