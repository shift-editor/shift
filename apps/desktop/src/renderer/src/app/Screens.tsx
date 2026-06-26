import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals/useSignal";
import { useEditor, useFont, useWorkspace, WorkspaceProvider } from "@/workspace/WorkspaceContext";
import { DebugProvider } from "@/context/DebugContext";

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
        <Route path="/home" element={<Home />} />
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
  const documentLoaded = useSignalState(font.$loaded);
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

  // Side effect of a document loading: give the editor room.
  useEffect(() => {
    if (!documentLoaded) return;

    async function maximiseWorkspaceWindow(): Promise<void> {
      try {
        await getShiftHost().commands.run("window.maximise");
      } catch (error) {
        console.error("maximise on document load failed", error);
      }
    }

    editor.scene.setLocation(font.defaultLocation());
    void maximiseWorkspaceWindow();
  }, [documentLoaded, editor, font]);

  if (connectionError) {
    return (
      <main className="grid h-screen place-items-center bg-canvas text-primary">
        Workspace failed to load.
      </main>
    );
  }

  if (!documentLoaded) return null;

  return <Outlet />;
};
