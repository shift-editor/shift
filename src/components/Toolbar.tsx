import PenIcon from "../assets/toolbar/pen.svg";
import SelectIcon from "../assets/toolbar/select.svg";
import AppState from "../store/store";

export const Toolbar = () => {
  const setActiveTool = AppState((state) => state.setActiveTool);

  return (
    <main className="flex items-center justify-center w-[100vw] h-[10vh] bg-[#2d2d2d] mb-4">
      <section className="flex items-center justify-center gap-2">
        <div
          className="p-2 hover:bg-gray-700 rounded transition-colors duration-200"
          onClick={() => setActiveTool("select")}
        >
          <SelectIcon />
        </div>
        <div
          className="p-2 hover:bg-gray-700 rounded transition-colors duration-200"
          onClick={() => setActiveTool("pen")}
        >
          <PenIcon />
        </div>
      </section>
    </main>
  );
};
