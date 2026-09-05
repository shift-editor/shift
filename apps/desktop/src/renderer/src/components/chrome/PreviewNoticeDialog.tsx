import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  cn,
} from "@shift/ui";

interface PreviewNoticeDialogProps {
  open: boolean;
  canConvert: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveAsShift: () => Promise<void>;
}

/** Explains preview restrictions and offers conversion when the source supports it. */
export const PreviewNoticeDialog = ({
  open,
  canConvert,
  onOpenChange,
  onSaveAsShift,
}: PreviewNoticeDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogBackdrop />
      <DialogPopup
        className={cn(
          "fixed left-1/2 top-1/2 w-[320px] -translate-x-1/2 -translate-y-1/2",
          "rounded-lg border border-line-subtle bg-canvas p-4 shadow-lg",
        )}
      >
        <DialogTitle className="text-base font-medium text-primary">
          {canConvert ? "Save as Shift to edit" : "Read-only preview"}
        </DialogTitle>
        <p className="mt-2 text-sm text-muted">
          {canConvert
            ? "This font is open as a read-only preview. Save it as a Shift document to make changes."
            : "This font is read-only. You can inspect it, but editing and conversion aren’t supported."}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          {canConvert ? (
            <>
              <DialogClose render={<Button size="sm">Cancel</Button>} />
              <Button size="sm" variant="primary" onClick={onSaveAsShift}>
                Save as Shift…
              </Button>
            </>
          ) : (
            <DialogClose
              render={
                <Button size="sm" variant="primary" className="h-6 min-w-16 px-4">
                  OK
                </Button>
              }
            />
          )}
        </div>
      </DialogPopup>
    </DialogPortal>
  </Dialog>
);
