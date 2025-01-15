import { EditorView } from "./EditorView";

export const App = () => {
  return (
    <main className="w-screen h-screen flex items-center justify-center flex-col p-10">
      <h1>Glyph editor</h1>
      <EditorView />
    </main>
  );
};
