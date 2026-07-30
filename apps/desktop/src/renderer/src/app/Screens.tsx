import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";

import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { useSignalState } from "@/lib/signals/useSignal";
import { useEditor, useFont, useWorkspace } from "@/workspace/WorkspaceContext";
import { WorkspaceProvider } from "@/workspace/WorkspaceProvider";
import { DebugProvider } from "@/context/DebugProvider";
import { SettingsNavigationProvider } from "@/context/SettingsNavigationProvider";

/**
 * Routes launcher and workspace windows to their screen trees.
 *
 * @remarks
 * Main chooses the initial route when it creates a window. Launcher routes do
 * not connect to a workspace; workspace routes connect through the sender
 * window and fail if main has not attached that window to a session.
 */
export const Screens = () => {
  return (
    <Routes>
      <Route path="/launcher" element={<Landing />} />
      <Route
        element={
          <WorkspaceProvider>
            <DebugProvider>
              <WorkspaceScreens />
            </DebugProvider>
          </WorkspaceProvider>
        }
      >
        <Route path="/home" />
        <Route path="/editor/:glyphId" element={<Editor />} />
      </Route>
      <Route path="*" element={<Navigate to="/launcher" replace />} />
    </Routes>
  );
};

const WorkspaceScreens = () => {
  const workspace = useWorkspace();
  const font = useFont();
  const editor = useEditor();
  const location = useLocation();
  const documentLoaded = useSignalState(font.loadedCell);
  const [connectionError, setConnectionError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function connectWorkspace(): Promise<void> {
      try {
        await workspace.connect();
      } catch (error) {
        console.error("workspace failed to connect", error);
        if (!cancelled) setConnectionError(error);
      }
    }

    void connectWorkspace();

    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => {
    if (!documentLoaded) return;

    editor.setDesignLocation(font.defaultLocation());
  }, [documentLoaded, editor, font]);

  if (connectionError) {
    return (
      <main className="grid h-screen place-items-center bg-canvas text-primary">
        Workspace failed to load.
      </main>
    );
  }

  if (!documentLoaded) return null;

  // Preserve the resident catalog atlas across screen navigation. Route visibility
  // must not own the WebGPU device or trigger another complete atlas upload.
  const catalogActive = location.pathname === "/home";

  return (
    <SettingsNavigationProvider>
      <div
        aria-hidden={!catalogActive}
        className={catalogActive ? undefined : "pointer-events-none fixed inset-0 z-0"}
        inert={!catalogActive}
      >
        <Home />
      </div>
      <div className={catalogActive ? undefined : "relative z-10"}>
        <Outlet />
      </div>
    </SettingsNavigationProvider>
  );
};
