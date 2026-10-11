import { useEffect, useState } from "react";
import type { AgentConnectionsState } from "@shared/agent/connections";
import { getShiftHost } from "@/host/shiftHost";

/**
 * Main-owned agent connection state, kept current by main's change events.
 *
 * @returns the latest state, or `null` until main has answered.
 */
export function useAgentConnections(): AgentConnectionsState | null {
  const [state, setState] = useState<AgentConnectionsState | null>(null);

  useEffect(() => {
    const connections = getShiftHost().agentConnections;
    let active = true;
    const unsubscribe = connections.onChanged((next) => {
      if (active) setState(next);
    });
    void connections.state().then((initial) => {
      if (active) setState((current) => current ?? initial);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
