import AppState from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";

export const EditorView = () => {
  const activeTool = AppState((state) => state.activeTool);

  return (
    <div
      className={`relative h-full w-full overflow-hidden cursor-${activeTool}`}
    >
      <StaticScene />
      <InteractiveScene />
      <Metrics />
    </div>
  );
};
