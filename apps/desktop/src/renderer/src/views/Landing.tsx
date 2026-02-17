import { useNavigate } from "react-router-dom";
import { clearDirty, getEditor, setFilePath } from "@/store/store";
import { glyphDataStore } from "@/store/GlyphDataStore";
import { documentPersistence } from "@/persistence";
import logo from "@/assets/logo@1024.png";
import { Button } from "@shift/ui";
import { glyphRefFromUnicode } from "@/lib/utils/unicode";
import { RecentFiles } from "./RecentFiles";

export const Landing = () => {
  const navigate = useNavigate();

  const openFont = (filePath: string) => {
    const editor = getEditor();
    editor.loadFont(filePath);
    editor.updateMetricsFromFont();
    setFilePath(filePath);
    clearDirty();
    documentPersistence.openDocument(filePath);
    navigate("/home");
  };

  const handleLoadFont = async () => {
    const filePath = await window.electronAPI?.openFontDialog();
    if (filePath) {
      openFont(filePath);
    }
  };

  const handleNewFont = () => {
    const editor = getEditor();
    const glyphRef = glyphRefFromUnicode(65, editor.fontEngine.info);
    editor.setMainGlyphUnicode(65);
    editor.startEditSession(glyphRef);
    editor.setDrawOffsetForGlyph({ x: 0, y: 0 }, glyphRef);
    glyphDataStore.onFontUnloaded();
    setFilePath(null);
    clearDirty();
    documentPersistence.closeDocument();
    navigate("/home");
  };

  return (
    <section className="bg-canvas flex h-screen flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-2">
        <img src={logo} alt="Shift" className="h-32 w-32" />
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-primary">
          Shift <span className="ml-[-0.4rem]">.</span>
        </h1>
      </div>
      <div className="flex gap-2 sm:flex-row">
        <Button onClick={handleLoadFont} variant="ghost">
          Load font
        </Button>
        <Button onClick={handleNewFont} variant="ghost">
          New font
        </Button>
      </div>
      <RecentFiles onOpenFile={openFont} />
    </section>
  );
};
