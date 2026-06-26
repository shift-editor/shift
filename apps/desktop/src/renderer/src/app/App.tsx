import "./App.css";
import { HashRouter } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { ZoomToast } from "@/components/chrome/ZoomToast";

import { Screens } from "./Screens";

export const App = () => {
  return (
    <ThemeProvider defaultTheme="light">
      <ZoomToast>
        <FocusZoneProvider defaultZone="canvas">
          <HashRouter>
            <Screens />
          </HashRouter>
        </FocusZoneProvider>
      </ZoomToast>
    </ThemeProvider>
  );
};

export default App;
