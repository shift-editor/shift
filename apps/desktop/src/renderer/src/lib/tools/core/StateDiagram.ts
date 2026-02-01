export interface StateTransition {
  from: string;
  to: string;
  event: string;
}

export interface StateDiagram<S extends string = string> {
  states: S[];
  initial: S;
  transitions: StateTransition[];
}

export function defineStateDiagram<S extends string>(diagram: StateDiagram<S>): StateDiagram<S> {
  return diagram;
}

export function transitionInDiagram(
  spec: StateDiagram,
  from: string,
  eventName: string,
  to: string,
): boolean {
  return spec.transitions.some((t) => t.from === from && t.event === eventName && t.to === to);
}
