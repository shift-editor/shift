import { useEffect, useState, type ReactNode } from "react";
import "@/types/window";
import type { FontSession } from "./FontSession";
import { FontSessionContext, WorkspaceContext } from "./WorkspaceContext";
import { getFontSession } from "./runtime";

export function FontSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<FontSession | null>(null);
  const [connectionError, setConnectionError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    async function connect(): Promise<void> {
      try {
        const connected = await getFontSession();
        if (active) setSession(connected);
      } catch (error) {
        console.error("font session failed to connect", error);
        if (active) setConnectionError(error);
      }
    }

    void connect();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return undefined;

    window.shiftSession = session;
    const workspace = session.workspace;
    if (workspace) window.shift = workspace;

    return () => {
      delete window.shift;
      delete window.shiftSession;
    };
  }, [session]);

  if (connectionError) {
    return (
      <main className="grid h-screen place-items-center bg-canvas text-primary">
        Font session failed to load.
      </main>
    );
  }
  if (!session) return null;

  return (
    <FontSessionContext.Provider value={session}>
      <WorkspaceContext.Provider value={session.workspace}>{children}</WorkspaceContext.Provider>
    </FontSessionContext.Provider>
  );
}
