export type EventName = 'points:added' | 'points:moved' | 'points:removed' | 'segment:upgraded';
export type EventHandler<T> = (data: T) => void;

export interface IEventEmitter {
  on<T>(event: EventName, handler: EventHandler<T>): void;
  emit<T>(event: EventName, data: T): void;
  off<T>(event: EventName, handler: EventHandler<T>): void;
}
