import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";

import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { useSignalState } from "@/lib/signals/useSignal";
import { useEditor, useFont, useFontSession } from "@/workspace/WorkspaceContext";
import { FontSessionProvider } from "@/workspace/FontSessionProvider";
import { DebugProvider } from "@/context/DebugProvider";
import { SettingsNavigationProvider } from "@/context/SettingsNavigationProvider";
import { GlyphCatalogProvider } from "@/context/GlyphCatalogProvider";
import { ReadOnlyNoticeDialog } from "@/components/chrome/ReadOnlyNoticeDialog";
import { AboutScreen } from "@/views/AboutScreen";
import { UpdateScreen } from "@/views/UpdateScreen";

/**
 * Routes launcher, updater, and workspace windows to their screen trees.
 *
 * @remarks
 * Main chooses the initial route when it creates a window. Launcher and updater
 * routes do not connect to a workspace; workspace routes connect through the
 * sender window and fail if main has not attached that window to a session.
 */
export const Screens = () => {
  return (
    <Routes>
      <Route path="/about" element={<AboutScreen />} />
      <Route path="/launcher" element={<Landing />} />
      <Route path="/update" element={<UpdateScreen />} />
      <Route
        element={
          <FontSessionProvider>
            <DebugProvider>
              <FontSessionScreens />
            </DebugProvider>
          </FontSessionProvider>
        }
      >
        <Route path="/home" />
        <Route path="/editor/:glyphId" element={<Editor />} />
      </Route>
      <Route path="*" element={<Navigate to="/launcher" replace />} />
    </Routes>
  );
};

const FontSessionScreens = () => {
  const session = useFontSession();
  const location = useLocation();

  // Preserve the resident catalog atlas across screen navigation. Route visibility
  // must not own the WebGPU device or trigger another complete atlas upload.
  const catalogActive = location.pathname === "/home";

  return (
    <GlyphCatalogProvider>
      <SettingsNavigationProvider>
        <ShiftSessionSetup />
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
        {session.mode === "authored" ? null : (
          <ReadOnlyNoticeDialog canConvert={session.canConvert} />
        )}
      </SettingsNavigationProvider>
    </GlyphCatalogProvider>
  );
};

const ShiftSessionSetup = () => {
  const session = useFontSession();
  const font = useFont();
  const editor = useEditor();
  const documentLoaded = useSignalState(font.loadedCell);

  useEffect(() => {
    if (!documentLoaded) return;

    editor.setExternalLocation(font.defaultLocation());
    if (session.mode === "authored") editor.selectSource(font.defaultSource.id);
  }, [documentLoaded, editor, font, session.mode]);

  return null;
};
