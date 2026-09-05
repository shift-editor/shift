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
import { message } from "@shared/messages";

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
          {message(canConvert ? "preview.convertible.title" : "preview.readOnly.title")}
        </DialogTitle>
        <p className="mt-2 text-sm text-muted">
          {message(canConvert ? "preview.convertible.description" : "preview.readOnly.description")}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          {canConvert ? (
            <>
              <DialogClose render={<Button size="sm">{message("action.cancel")}</Button>} />
              <Button size="sm" variant="primary" onClick={onSaveAsShift}>
                {message("action.saveAsShift")}
              </Button>
            </>
          ) : (
            <DialogClose
              render={
                <Button size="sm" variant="primary" className="h-6 min-w-16 px-4">
                  {message("action.ok")}
                </Button>
              }
            />
          )}
        </div>
      </DialogPopup>
    </DialogPortal>
  </Dialog>
);
