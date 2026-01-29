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
