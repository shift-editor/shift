import type { GlyphOutlineControls } from "@shift/editor/types";

export interface SourcesProps {
  readonly canAuthor: boolean;
  readonly outlineControls?: GlyphOutlineControls;
}

export interface InstancesProps {
  readonly canAuthor: boolean;
  readonly outlineControls?: GlyphOutlineControls;
}

export interface OutlineVisibilityButtonProps {
  readonly visible: boolean;
  readonly inherited?: boolean;
  readonly alwaysOpen?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}
