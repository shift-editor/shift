import "./index.css";
import "./App.css";
import { App } from "./components/App";

export const AppWrapper = () => {
  return (
    <div className="w-screen h-screen flex items-center justify-center flex-col">
      <App />
    </div>
  );
};

export default AppWrapper;
