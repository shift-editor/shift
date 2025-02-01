import HandIcon from "../assets/toolbar/hand.svg";
import PenIcon from "../assets/toolbar/pen.svg";
import SelectIcon from "../assets/toolbar/select.svg";
import AppState from "../store/store";

export const Toolbar = () => {
  const setActiveTool = AppState((state) => state.setActiveTool);
  const activeTool = AppState((state) => state.activeTool);

  return (
    <main className="flex h-[10vh] w-[100vw] items-center justify-center bg-[#2d2d2d]">
      <section className="flex items-center justify-center gap-2">
        <div
          className={`rounded p-2 transition-colors duration-200 ${
            activeTool === "select" ? "bg-gray-700" : "hover:bg-gray-700"
          }`}
          onClick={() => setActiveTool("select")}
        >
          <SelectIcon />
        </div>
        <div
          className={`rounded p-2 transition-colors duration-200 ${
            activeTool === "pen" ? "bg-gray-700" : "hover:bg-gray-700"
          }`}
          onClick={() => setActiveTool("pen")}
        >
          <PenIcon />
        </div>
        <div
          className={`rounded p-2 transition-colors duration-200 ${
            activeTool === "hand" ? "bg-gray-700" : "hover:bg-gray-700"
          }`}
          onClick={() => setActiveTool("hand")}
        >
          <HandIcon />
        </div>
      </section>
    </main>
  );
};
