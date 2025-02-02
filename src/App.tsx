import "./index.css";
import "./App.css";
import { App } from "./components/App";
import { CanvasContextProvider } from "./context/CanvasContext";

export const AppWrapper = () => {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <CanvasContextProvider>
        <App />
      </CanvasContextProvider>
    </div>
  );
};

export default AppWrapper;
