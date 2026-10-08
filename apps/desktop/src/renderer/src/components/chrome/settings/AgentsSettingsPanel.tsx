import { useEffect, useState } from "react";
import { Button, Check, Copy, Switch, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import type { AgentConnectionsState, CommandLineToolState } from "@shared/agent/connections";
import { getShiftHost } from "@/host/shiftHost";
import { useAgentConnections } from "@/hooks/useAgentConnections";

const EXAMPLE_PROMPT = "Look at the glyph I have open in Shift and describe its contours.";

/** Settings → Agents: allow local agents to connect, and how to connect them. */
export const AgentsSettingsPanel = () => {
  const state = useAgentConnections();
  const [pending, setPending] = useState(false);

  if (!state) return null;

  return (
    <section className="flex h-full flex-col gap-5 overflow-y-auto p-6" aria-label="Agents">
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-sm font-medium text-primary">Agents</h2>
        <p className="text-ui text-secondary">
          Let AI agents on this computer read your open fonts through Shift's MCP server. Agents can
          inspect and capture Shift, but cannot change your fonts.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label className="flex items-center justify-between gap-4 text-sm text-primary">
          Allow agent connections
          <Switch
            checked={state.allowed}
            aria-label="Allow agent connections"
            disabled={pending}
            onCheckedChange={async (allowed) => {
              setPending(true);
              try {
                await getShiftHost().agentConnections.setAllowed(allowed);
              } finally {
                setPending(false);
              }
            }}
          />
        </label>
        <ConnectionStatus state={state} />
      </div>

      <ConnectionSteps state={state} />

      <CommandLineToolSection />
    </section>
  );
};

const ConnectionStatus = ({ state }: { state: AgentConnectionsState }) => {
  const now = useNow(5_000);

  if (state.status === "off") return null;
  if (state.status === "failed") {
    return (
      <p role="alert" className="text-ui text-error">
        {state.error}
      </p>
    );
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

const ConnectionSteps = ({ state }: { state: AgentConnectionsState }) => {
  const { serverName, url } = state;
  const claudeCommand = `claude mcp add --transport http --scope user ${serverName} ${url}`;
  const config = JSON.stringify({ mcpServers: { [serverName]: { type: "http", url } } }, null, 2);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-ui font-medium text-primary">Connect an agent</h3>
      <ol className="flex list-decimal flex-col gap-4 pl-4 text-ui text-secondary marker:text-muted">
        <li>
          <div className="flex flex-col gap-2">
            For Claude Code, run this in your terminal:
            <CodeSnippet label="Claude Code command" text={claudeCommand} />
            For other agents, add Shift to the agent's MCP config:
            <CodeSnippet label="MCP config" text={config} />
            <span className="text-muted">
              Shift runs a Streamable HTTP MCP server on this computer. Your agent may use a
              different config format, so check its documentation and adapt the snippet as needed.
            </span>
          </div>
        </li>
        <li>
          <div className="flex flex-col gap-2">
            Ask your agent something about your font to test the connection:
            <CodeSnippet label="Example prompt" text={EXAMPLE_PROMPT} />
          </div>
        </li>
      </ol>
    </div>
  );
};

const CodeSnippet = ({ label, text }: { label: string; text: string }) => (
  <div className="relative">
    <pre
      aria-label={label}
      className="overflow-x-auto whitespace-pre-wrap rounded border border-line-subtle bg-surface py-2 pl-3 pr-10 font-mono text-ui text-primary"
    >
      {text}
    </pre>
    <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
  </div>
);

const CommandLineToolSection = () => {
  const [tool, setTool] = useState<CommandLineToolState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getShiftHost()
      .commandLineTool.state()
      .then((state) => {
        if (active) setTool(state);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!tool || tool.status === "unavailable") return null;

  return (
    <div
      className="flex flex-col gap-2 border-t border-line-subtle pt-4"
      aria-label="Command-line tool"
    >
      <h3 className="text-ui font-medium text-primary">Command-line tool</h3>
      <p className="text-ui text-secondary">
        <code className="font-mono">shift-cli</code> reads, edits, and compiles saved fonts from a
        terminal or CI, matching this version of Shift.
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="default"
          disabled={installing}
          onClick={async () => {
            setInstalling(true);
            setError(null);
            try {
              setTool(await getShiftHost().commandLineTool.install());
            } catch (installError) {
              setError(installFailure(installError));
            } finally {
              setInstalling(false);
            }
          }}
        >
          {installLabel(tool.status)}
        </Button>
        <span className="text-ui text-secondary" aria-label="Command-line tool status">
          {installStatus(tool)}
        </span>
      </div>
      {tool.note && tool.status === "installed" ? (
        <p className="text-ui text-muted">{tool.note}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
};

function installLabel(status: CommandLineToolState["status"]): string {
  switch (status) {
    case "installed":
      return "Reinstall";
    case "outdated":
      return "Update";
    case "conflict":
      return "Replace";
    default:
      return "Install command-line tool";
  }
}

function installStatus({ status, commandPath }: CommandLineToolState): string {
  switch (status) {
    case "installed":
      return `Installed at ${commandPath}`;
    case "outdated":
      return `An older copy is at ${commandPath}`;
    case "conflict":
      return `A different shift-cli is at ${commandPath}`;
    default:
      return "Not installed";
  }
}

function installFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/User canceled|cancelled|-128|dismissed/i.test(message)) {
    return "Installation was cancelled.";
  }
  return `Could not install shift-cli: ${message}`;
}

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant="muted"
          size="icon-sm"
          aria-label={label}
          className="absolute right-1.5 top-1.5"
          onClick={async () => {
            await getShiftHost().clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
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
