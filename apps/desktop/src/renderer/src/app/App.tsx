import "./App.css";
import { useEffect } from "react";
import { HashRouter } from "react-router";
import { TooltipProvider } from "@shift/ui";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { ZoomToast } from "@/components/chrome/ZoomToast";

import { Screens } from "./Screens";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { reportRendererError } from "./errorReporting";

export const App = () => {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportRendererError("window.error", event.error ?? event.message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportRendererError("unhandledrejection", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider delayDuration={500}>
        <ZoomToast>
          <FocusZoneProvider defaultZone="canvas">
            <HashRouter>
              <AppErrorBoundary>
                <Screens />
              </AppErrorBoundary>
            </HashRouter>
          </FocusZoneProvider>
        </ZoomToast>
      </TooltipProvider>
    </ThemeProvider>
  );
};

export default App;
