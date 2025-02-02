import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";

export const EditorView = () => {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <StaticScene />
      <InteractiveScene />
      <Metrics />
    </div>
  );
};
