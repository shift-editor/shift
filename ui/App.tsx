import "./index.css";
import "./App.css";
import { App } from "./components/App";
import { CanvasContextProvider } from "./context/CanvasContext";

export const AppWrapper = () => {
  return (
    <CanvasContextProvider>
      <App />
    </CanvasContextProvider>
  );
};

export default AppWrapper;
