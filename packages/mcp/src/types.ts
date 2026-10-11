/** How a local client reaches one running Shift build's MCP server. */
export interface ShiftMcpConnection {
  url: string;
}

/** Recent agent activity on a running MCP server. */
export interface ShiftMcpActivity {
  /** Epoch milliseconds of the latest accepted request, or `null` before any. */
  lastRequestAt: number | null;
  /** Clients that introduced themselves recently, most recent first. */
  clients: { name: string; lastSeenAt: number }[];
}
