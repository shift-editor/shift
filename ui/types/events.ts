import { EntityId } from '@/lib/core/EntityId';

export type EventData = {
  'points:added': EntityId[];
  'points:moved': EntityId[];
  'points:removed': EntityId[];
  'segment:upgraded': EntityId[];
};

export type Event = keyof EventData;
export type EventHandler<T extends Event = Event> = (data: EventData[T]) => void;
