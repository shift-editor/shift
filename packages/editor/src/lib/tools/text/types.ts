import type { Behavior } from "../core";

export type TextState = { type: "idle" } | { type: "typing" };

export type TextBehavior = Behavior<TextState>;
