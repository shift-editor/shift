import { useRef } from "react";
import AppState from "../../store/store";
import { Tool } from "../../types/tool";
import { tools } from "../tools/tools";

export class Editor {
  public constructor() {}

  public activeTool(): Tool {
    const activeTool = AppState.getState().activeTool;
    const tool = tools.get(activeTool);
    if (!tool) {
      throw new Error(`Tool ${activeTool} not found`);
    }

    return tool;
  }
}

export const getEditor = () => {
  const editorRef = useRef<Editor | null>(null);

  const editor = () => {
    if (!editorRef.current) {
      editorRef.current = new Editor();
    }
    return editorRef;
  };

  return editor();
};
