export type RulerState =
  | {
      type: "idle";
    }
  | {
      type: "ready";
    }
  | {
      type: "dragging";
    };
