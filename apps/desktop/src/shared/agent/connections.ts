/** Main-owned state of local agent connections, as shown in Settings → Agents. */
export interface AgentConnectionsState {
  /** Whether the user allows agents to connect; off until turned on. */
  allowed: boolean;
  /** `listening` while the server runs, `failed` when allowed but it could not start. */
  status: "off" | "listening" | "failed";
  /** This build's MCP server name, as agents should register it. */
  serverName: string;
  /** This build's loopback MCP URL. */
  url: string;
  /** Why the server could not start, when `status` is `failed`. */
  error: string | null;
  /** Recent requests and the agents that introduced themselves. */
  activity: {
    lastRequestAt: number | null;
    clients: { name: string; lastSeenAt: number }[];
  };
}
