import { useNavigate } from "react-router-dom";
import AppState from "@/store/store";
import { Toolbar } from "@/components/Toolbar";

export const Landing = () => {
  const navigate = useNavigate();

  const handleLoadFont = async () => {
    const filePath = await window.electronAPI?.openFontDialog();
    if (filePath) {
      const editor = AppState.getState().editor;
      editor.loadFont(filePath);
      editor.updateMetricsFromFont();
      AppState.getState().setFilePath(filePath);
      AppState.getState().clearDirty();
      navigate("/home");
    }
  };

  const handleNewFont = () => {
    const editor = AppState.getState().editor;
    editor.startEditSession(65);
    AppState.getState().setFilePath(null);
    AppState.getState().clearDirty();
    navigate("/home");
  };

  return (
    <main className="grid h-full w-full grid-rows-[auto_1fr]">
      <Toolbar />
      <section className="bg-secondary flex h-[90vh] items-center justify-center">
        <div className="flex gap-4">
          <button
            onClick={handleLoadFont}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-3 font-medium"
          >
            load font
          </button>
          <button
            onClick={handleNewFont}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-3 font-medium"
          >
            new font
          </button>
        </div>
      </section>
    </main>
  );
};
