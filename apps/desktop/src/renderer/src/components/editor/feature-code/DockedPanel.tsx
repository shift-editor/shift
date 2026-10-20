import type { ReactNode } from "react";
import { Button, Tooltip, X } from "@shift/ui";

interface DockedPanelProps {
  /** Names the panel for assistive technology. */
  readonly label: string;
  /** What the header shows; defaults to `label`. */
  readonly title?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** A panel docked under the feature code, such as Problems or References, with a close button. */
export const DockedPanel = ({ label, title, onClose, children }: DockedPanelProps) => (
  <aside
    aria-label={label}
    className="flex max-h-64 shrink-0 flex-col border-t border-line-subtle bg-surface"
  >
    <header className="flex h-8 shrink-0 items-center justify-between gap-3 pr-1.5 pl-4">
      <h2 className="min-w-0 truncate text-ui font-medium text-primary">{title ?? label}</h2>
      <Tooltip content="Close">
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </Tooltip>
    </header>
    <div className="min-h-0 overflow-y-auto pb-1.5">{children}</div>
  </aside>
);
