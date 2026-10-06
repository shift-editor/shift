import type { Behavior } from "../core";

export type TextState = { type: "idle" } | { type: "ready" } | { type: "editing" };

export type TextBehavior = Behavior<TextState>;
