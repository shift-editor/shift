import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";

export const App = () => {
  return (
    <>
      <Toolbar />
      <main className="w-screen h-screen flex items-center justify-center flex-col p-10">
        <EditorView />
      </main>
    </>
  );
};
