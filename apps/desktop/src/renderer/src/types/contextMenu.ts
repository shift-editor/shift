import type { ReactNode } from "react";

export interface CanvasContextMenuProps {
  readonly children: ReactNode;
}

export interface ObjectContextMenuProps {
  readonly children: ReactNode;
  readonly selectObject: () => void;
}
