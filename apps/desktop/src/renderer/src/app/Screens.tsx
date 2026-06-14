import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { getFont } from "@/store/appStore";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals/useSignal";

/**
 * The entire top-level screen structure, in one place.
 *
 * @remarks
 * Whether a document is loaded — not the URL — decides the launcher vs. the
 * workspace, so it reads top-to-bottom as a guard. URL routing only addresses
 * what's *inside* the workspace (which glyph). Loading a document is what flips
 * the screen, regardless of trigger (New, Open, future recovery); views never
 * navigate to make it happen.
 */
export const Screens = () => {
  const documentLoaded = useSignalState(getFont().$loaded);

  // Side effect of a document loading: give the editor room.
  useEffect(() => {
    if (!documentLoaded) return;

    void getShiftHost()
      .commands.run("window.maximise")
      .catch((error) => console.error("maximise on document load failed", error));
  }, [documentLoaded]);

  if (!documentLoaded) return <Landing />;

  return (
    <Routes>
      <Route path="/home" element={<Home />} />
      <Route path="/editor/:glyphName" element={<Editor />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
};
