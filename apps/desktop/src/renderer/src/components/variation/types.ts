import type { GlyphOutlineControls } from "@/types/glyphOutline";

export interface SourcesProps {
  readonly canAuthor: boolean;
}

export interface InstancesProps {
  readonly canAuthor: boolean;
  readonly outlineControls?: GlyphOutlineControls;
}

export interface OutlineVisibilityButtonProps {
  readonly visible: boolean;
  readonly alwaysOpen?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}
