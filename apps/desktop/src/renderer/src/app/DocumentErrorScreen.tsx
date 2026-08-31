import { Button } from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import { ErrorDialog } from "./ErrorDialog";

type DocumentErrorScreenProps = {
  error: unknown;
  componentStack?: string;
};

export function DocumentErrorScreen({ error, componentStack }: DocumentErrorScreenProps) {
  async function reopenDocument(): Promise<void> {
    try {
      await getShiftHost().window.reopenDocument();
    } catch (error) {
      console.error("document reopen failed", error);
    }
  }

  async function closeWindow(): Promise<void> {
    try {
      await getShiftHost().commands.run("window.close");
    } catch (error) {
      console.error("document close failed", error);
    }
  }

  return (
    <ErrorDialog
      title="Something went wrong with this document"
      description="Your completed edits are safe. Reopen the document to continue."
      error={error}
      componentStack={componentStack}
    >
      <Button variant="primary" onClick={reopenDocument}>
        Reopen Document
      </Button>
      <Button onClick={closeWindow}>Close Window</Button>
    </ErrorDialog>
  );
}
