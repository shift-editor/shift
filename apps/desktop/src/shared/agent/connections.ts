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

/** Whether the `shift-cli` bundled with the app is on the user's PATH. */
export interface CommandLineToolState {
  /**
   * `unavailable` when this build has no bundled binary; `conflict` when a different
   * `shift-cli` is at the install location; `outdated` when an installed copy is older.
   */
  status: "unavailable" | "notInstalled" | "installed" | "outdated" | "conflict";
  /** Where the installed command lives, or the bundled binary on Windows. */
  commandPath: string | null;
  /** A follow-up step for the user, such as adding a directory to PATH. */
  note: string | null;
}
