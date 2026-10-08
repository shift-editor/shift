import { useEffect, useState } from "react";
import { Button, Checkbox } from "@shift/ui";
import type { AgentConnectionsState } from "@shared/agent/connections";
import { getShiftHost } from "@/host/shiftHost";
import { useAgentConnections } from "@/hooks/useAgentConnections";

/** Settings → Agents: allow local agents to connect, and how to connect them. */
export const AgentsSettingsPanel = () => {
  const state = useAgentConnections();
  const [pending, setPending] = useState(false);

  if (!state) return null;

  return (
    <section className="flex flex-col gap-5 p-6" aria-label="Agents">
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-sm font-medium text-primary">Agents</h2>
        <p className="text-ui text-secondary">
          Let AI agents on this computer read your open fonts through Shift's MCP server. Agents can
          inspect and capture Shift, but cannot change your fonts.
        </p>
      </header>

      <label className="flex items-center gap-2 text-sm text-primary">
        <Checkbox
          checked={state.allowed}
          disabled={pending}
          aria-label="Allow agent connections"
          onCheckedChange={async (allowed) => {
            setPending(true);
            try {
              await getShiftHost().agentConnections.setAllowed(allowed);
            } finally {
              setPending(false);
            }
          }}
        />
        Allow agent connections
      </label>

      <ConnectionStatus state={state} />

      {state.allowed && state.status === "listening" ? <ConnectionCommands state={state} /> : null}
    </section>
  );
};

const ConnectionStatus = ({ state }: { state: AgentConnectionsState }) => {
  const now = useNow(5_000);

  if (state.status === "failed") {
    return (
      <p role="alert" className="text-ui text-error">
        {state.error}
      </p>
    );
  }
  if (state.status === "off") {
    return <p className="text-ui text-muted">Agents cannot connect while this is off.</p>;
  }

  const { lastRequestAt, clients } = state.activity;
  const names = clients.map(({ name }) => name).join(", ");
  return (
    <p className="flex items-center gap-2 text-ui text-secondary" aria-label="Agent activity">
      <span aria-hidden className={lastRequestAt === null ? "text-muted" : "text-accent"}>
        ●
      </span>
      {lastRequestAt === null
        ? "Listening. No agent has connected yet."
        : `${names || "An agent"} · last request ${relativeTime(now - lastRequestAt)}`}
    </p>
  );
};

const ConnectionCommands = ({ state }: { state: AgentConnectionsState }) => {
  const { serverName, url } = state;
  const clients = [
    {
      name: "Claude Code",
      command: `claude mcp add --transport http --scope user ${serverName} ${url}`,
    },
    { name: "Codex", command: `[mcp_servers.${serverName}]\nurl = "${url}"` },
    { name: "Other clients", command: url, note: "Add a Streamable HTTP server with this URL." },
  ];

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-ui font-medium text-primary">Connect an agent</h3>
      {clients.map((client) => (
        <div key={client.name} className="flex flex-col gap-1">
          <span className="text-ui text-secondary">{client.name}</span>
          <div className="flex items-start gap-2">
            <pre
              aria-label={`${client.name} setup`}
              className="min-w-0 flex-1 overflow-x-auto rounded border border-line-subtle bg-surface px-2 py-1.5 font-mono text-ui text-primary"
            >
              {client.command}
            </pre>
            <CopyButton text={client.command} label={`Copy ${client.name} setup`} />
          </div>
          {client.note ? <span className="text-ui text-muted">{client.note}</span> : null}
        </div>
      ))}
    </div>
  );
};

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <Button
      variant="default"
      aria-label={label}
      onClick={async () => {
        await getShiftHost().clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
}

function relativeTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
