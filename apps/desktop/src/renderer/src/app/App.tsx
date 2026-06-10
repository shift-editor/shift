import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { DebugProvider } from "@/context/DebugContext";
import { ZoomToast } from "@/components/chrome/ZoomToast";

import { RouteDispatcher } from "./RouteDispatcher";

export const App = () => {
  useEffect(() => {}, []);

  return (
    <ThemeProvider defaultTheme="light">
      <DebugProvider>
        <ZoomToast>
          <FocusZoneProvider defaultZone="canvas">
            <HashRouter>
              <Routes>
                <Route path="*" element={<RouteDispatcher />} />
              </Routes>
            </HashRouter>
          </FocusZoneProvider>
        </ZoomToast>
      </DebugProvider>
    </ThemeProvider>
  );
};

export default App;
