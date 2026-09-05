import type { ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTitle } from "@shift/ui";

type ErrorDialogProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function ErrorDialog({ title, description, children }: ErrorDialogProps) {
  return (
    <main className="h-screen bg-canvas text-primary">
      <Dialog open>
        <DialogPortal>
          <DialogBackdrop className="bg-canvas" />
          <DialogPopup className="top-1/2 w-[min(40rem,calc(100vw-4rem))] max-w-none -translate-y-1/2 rounded-lg bg-panel p-6 shadow-lg">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <p className="mt-2 text-sm text-secondary">{description}</p>
            <div className="mt-5 flex gap-2">{children}</div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </main>
  );
}
