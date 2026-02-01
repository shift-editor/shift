import { useLocation } from "react-router-dom";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";

const EDITOR_PATH = /^\/editor\/([^/]+)$/;

export const WorkspaceLayout = () => {
  const { pathname } = useLocation();
  const editorMatch = pathname.match(EDITOR_PATH);
  const glyphId = editorMatch?.[1];
  const isEditor = !!glyphId;

  return (
    <div className="h-full w-full">
      <div
        className="h-full w-full"
        style={{ display: isEditor ? "none" : undefined }}
        aria-hidden={isEditor}
      >
        <Home />
      </div>
      {isEditor && (
        <div className="h-full w-full">
          <Editor glyphId={glyphId} />
        </div>
      )}
    </div>
  );
};
