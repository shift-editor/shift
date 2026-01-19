import { signal, type WritableSignal } from "@/lib/reactive/signal";

export interface StateMachine<TState extends { type: string }> {
  readonly state: WritableSignal<TState>;
  readonly currentType: TState["type"];
  readonly current: TState;
  transition(newState: TState): void;
  isIn<T extends TState["type"]>(...types: T[]): boolean;
  when<T extends TState["type"]>(
    type: T,
    handler: (state: Extract<TState, { type: T }>) => void,
  ): void;
  match<R>(handlers: {
    [K in TState["type"]]?: (state: Extract<TState, { type: K }>) => R;
  }): R | undefined;
}

export function createStateMachine<TState extends { type: string }>(
  initial: TState,
): StateMachine<TState> {
  const stateSignal = signal<TState>(initial);

  return {
    get state(): WritableSignal<TState> {
      return stateSignal;
    },

    get currentType(): TState["type"] {
      return stateSignal.value.type;
    },

    get current(): TState {
      return stateSignal.value;
    },

    transition(newState: TState): void {
      stateSignal.set(newState);
    },

    isIn<T extends TState["type"]>(...types: T[]): boolean {
      return types.includes(stateSignal.value.type as T);
    },

    when<T extends TState["type"]>(
      type: T,
      handler: (state: Extract<TState, { type: T }>) => void,
    ): void {
      if (stateSignal.value.type === type) {
        handler(stateSignal.value as Extract<TState, { type: T }>);
      }
    },

    match<R>(handlers: {
      [K in TState["type"]]?: (state: Extract<TState, { type: K }>) => R;
    }): R | undefined {
      const currentState = stateSignal.value;
      const handler = handlers[currentState.type as TState["type"]];
      if (handler) {
        return handler(currentState as any);
      }
      return undefined;
    },
  };
}
