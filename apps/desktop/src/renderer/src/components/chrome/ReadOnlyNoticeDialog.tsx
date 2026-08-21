import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  X,
  cn,
} from "@shift/ui";

const MUTATION_CONTROL_SELECTOR = "[data-read-only-mutation]";

export type ReadOnlyNoticeDialogProps = {
  canConvert: boolean;
};

/** Intercepts preview mutation controls without changing their authored appearance. */
export const ReadOnlyNoticeDialog = ({ canConvert }: ReadOnlyNoticeDialogProps) => {
  const [readOnlyNoticeOpen, setReadOnlyNoticeOpen] = useState(false);

  useEffect(() => {
    const showReadOnlyNotice = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(MUTATION_CONTROL_SELECTOR)) return;

      event.preventDefault();
      event.stopPropagation();
      setReadOnlyNoticeOpen(true);
    };

    document.addEventListener("click", showReadOnlyNotice, true);
    return () => {
      document.removeEventListener("click", showReadOnlyNotice, true);
    };
  }, []);

  return (
    <Dialog open={readOnlyNoticeOpen} onOpenChange={setReadOnlyNoticeOpen}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line-subtle bg-canvas p-5 shadow-lg",
          )}
        >
          <DialogTitle className="text-base font-medium text-primary">
            Read-only preview
          </DialogTitle>
          <p className="mt-2 text-sm text-secondary">
            {canConvert
              ? "Save this source as a Shift document before making authoring changes."
              : "Compiled TTF and OTF fonts can be inspected here, but this preview cannot be edited or converted."}
          </p>
          <DialogClose
            className={cn(
              "absolute right-2 top-2 inline-flex h-7 w-7 cursor-pointer items-center justify-center",
              "rounded text-primary/70 transition-colors hover:bg-hover hover:text-primary",
            )}
            aria-label="Dismiss read-only notice"
          >
            <X className="h-4 w-4" />
          </DialogClose>
          <div className="mt-5 flex justify-end">
            <DialogClose render={<Button>OK</Button>} />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};
