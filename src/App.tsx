import "./index.css";
import "./App.css";
import { App } from "./components/App";

export const AppWrapper = () => {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <App />
    </div>
  );
};

export default AppWrapper;
