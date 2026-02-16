import { useLocation } from "react-router-dom";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";
import { FontInfo } from "@/views/FontInfo";

const EDITOR_PATH = /^\/editor\/([^/]+)$/;
const FONT_INFO_PATH = "/info";

export const WorkspaceLayout = () => {
  const { pathname } = useLocation();
  const editorMatch = pathname.match(EDITOR_PATH);
  const glyphId = editorMatch?.[1];
  const isEditor = !!glyphId;
  const isFontInfo = pathname === FONT_INFO_PATH;
  const showHome = !isEditor && !isFontInfo;

  return (
    <div className="h-full w-full">
      <div
        className="h-full w-full"
        style={{ display: showHome ? undefined : "none" }}
        aria-hidden={!showHome}
      >
        <Home />
      </div>
      <div
        className="h-full w-full"
        style={{ display: isFontInfo ? undefined : "none" }}
        aria-hidden={!isFontInfo}
      >
        <FontInfo />
      </div>
      {isEditor && (
        <div className="h-full w-full">
          <Editor glyphId={glyphId} />
        </div>
      )}
    </div>
  );
};
