import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { connectWorkspaceRuntime, getEditor, getFont } from "@/store/appStore";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals/useSignal";

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
      <Route element={<WorkspaceScreens />}>
        <Route path="/home" element={<Home />} />
        <Route path="/editor/:glyphId" element={<Editor />} />
      </Route>
      <Route path="*" element={<Navigate to="/launcher" replace />} />
    </Routes>
  );
};

const WorkspaceScreens = () => {
  const font = getFont();
  const editor = getEditor();
  const documentLoaded = useSignalState(font.$loaded);
  const [connectionError, setConnectionError] = useState<unknown>(null);

  useEffect(() => {
    void connectWorkspaceRuntime().catch((error) => {
      console.error("workspace runtime failed", error);
      setConnectionError(error);
    });
  }, []);

  // Side effect of a document loading: give the editor room.
  useEffect(() => {
    if (!documentLoaded) return;

    editor.scene.setLocation(font.defaultLocation());

    void getShiftHost()
      .commands.run("window.maximise")
      .catch((error) => console.error("maximise on document load failed", error));
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
