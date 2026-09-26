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
  /** Record whose outline the button controls; names the button apart from sibling rows. */
  readonly subject?: string;
  readonly onClick: () => void;
}
