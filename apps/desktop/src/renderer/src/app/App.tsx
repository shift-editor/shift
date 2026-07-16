import "./App.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { ZoomToast } from "@/components/chrome/ZoomToast";
import { rendererQueryClient } from "@/lib/query/queryClient";

import { Screens } from "./Screens";

export const App = () => {
  return (
    <QueryClientProvider client={rendererQueryClient}>
      <ThemeProvider defaultTheme="light">
        <ZoomToast>
          <FocusZoneProvider defaultZone="canvas">
            <HashRouter>
              <Screens />
            </HashRouter>
          </FocusZoneProvider>
        </ZoomToast>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
