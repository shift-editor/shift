import { Toolbar } from "@/components/Toolbar";
import { getEditor } from "@/store/store";

export const FontInfo = () => {
  const editor = getEditor();
  const metrics = editor.fontEngine.info.getMetrics();
  const metadata = editor.fontEngine.info.getMetadata();

  return (
    <>
      <Toolbar />
      <main className="text-light flex h-screen w-screen flex-col items-center justify-center text-white">
        <h1>{metadata.family} {metadata.styleName}</h1>
        <div>
          <p>Units per em: {metrics.unitsPerEm}</p>
          <p>Ascender: {metrics.ascender}</p>
          <p>Descender: {metrics.descender}</p>
          <p>Cap height: {metrics.capHeight}</p>
          <p>x-height: {metrics.xHeight}</p>
        </div>
      </main>
    </>
  );
};
