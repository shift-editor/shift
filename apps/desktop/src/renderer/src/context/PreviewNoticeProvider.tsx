import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { PreviewNoticeDialog } from "@/components/chrome/PreviewNoticeDialog";
import { getShiftHost } from "@/host/shiftHost";
import { useFontSession } from "@/workspace/WorkspaceContext";

const PreviewNoticeContext = createContext<(() => void) | null>(null);

export function usePreviewNotice(): () => void {
  const showPreviewNotice = useContext(PreviewNoticeContext);
  if (!showPreviewNotice) {
    throw new Error("usePreviewNotice must be used within a PreviewNoticeProvider");
  }

  return showPreviewNotice;
}

export const PreviewNoticeProvider = ({ children }: { children: ReactNode }) => {
  const session = useFontSession();
  const [previewNoticeOpen, setPreviewNoticeOpen] = useState(false);

  const showPreviewNotice = useCallback(() => {
    if (session.mode !== "preview") return;

    setPreviewNoticeOpen(true);
  }, [session.mode]);

  const handleSaveAsShift = useCallback(async () => {
    setPreviewNoticeOpen(false);

    try {
      await getShiftHost().commands.run("file.save");
    } catch (error) {
      console.error("preview conversion failed", error);
    }
  }, []);

  useEffect(
    () => session.editor.on("previewMutationAttempted", showPreviewNotice),
    [session.editor, showPreviewNotice],
  );

  return (
    <PreviewNoticeContext.Provider value={showPreviewNotice}>
      {children}
      <PreviewNoticeDialog
        open={previewNoticeOpen}
        canConvert={session.mode === "preview" && session.canConvert}
        onOpenChange={setPreviewNoticeOpen}
        onSaveAsShift={handleSaveAsShift}
      />
    </PreviewNoticeContext.Provider>
  );
};
