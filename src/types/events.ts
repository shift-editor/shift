import { EntityId } from "@/lib/core/EntityId";

export interface PointIdentifier {
  pointId: EntityId;
}

export type EventData = {
  "point:added": PointIdentifier;
  "point:moved": PointIdentifier;
  "point:removed": PointIdentifier;
};

export type Event = keyof EventData;
export type EventHandler<T extends Event = Event> = (
  data: EventData[T],
) => void;
