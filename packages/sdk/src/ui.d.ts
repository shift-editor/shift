import type { ReactElement, ReactNode } from "react";
import type { MemoryFontSession } from "./index.js";

export type EditorUISession = Pick<MemoryFontSession, "mode" | "font" | "editor">;

export interface ShiftEditorProps {
  session: EditorUISession;
}

export interface ShiftEditorChromeProps {
  session: EditorUISession;
}

export interface EditorToolbarHost {
  documentTitle: string;
  documentEdited: boolean;
  navigation?: ReactNode;
  windowControls?: ReactNode;
}

export interface EditorToolbarProps {
  session: EditorUISession;
  host?: EditorToolbarHost;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
}

export interface VariationSidebarSectionHost {
  content: ReactNode;
  actions?: ReactNode;
  active?: boolean;
}

export interface VariationSidebarHost {
  sources?: VariationSidebarSectionHost;
  instances?: VariationSidebarSectionHost;
  axes?: VariationSidebarSectionHost;
}

export interface VariationSidebarProps {
  session: EditorUISession;
  host?: VariationSidebarHost;
}

export interface GlyphSidebarHost {
  header?: ReactNode;
  selection?: ReactNode;
}

export interface GlyphSidebarProps {
  session: EditorUISession;
  host?: GlyphSidebarHost;
}

export declare function ShiftEditor(props: ShiftEditorProps): ReactElement;
export declare function ShiftEditorChrome(props: ShiftEditorChromeProps): ReactElement;
export declare function EditorToolbar(props: EditorToolbarProps): ReactElement;
export declare function VariationSidebar(props: VariationSidebarProps): ReactElement;
export declare function GlyphSidebar(props: GlyphSidebarProps): ReactElement;
