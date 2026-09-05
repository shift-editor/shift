import { Button } from "@shift/ui";
import { message } from "@shared/messages";
import { getShiftHost } from "@/host/shiftHost";
import { ErrorDialog } from "./ErrorDialog";

export function DocumentErrorScreen() {
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
      title={message("error.document.title")}
      description={message("error.document.description")}
    >
      <Button variant="primary" onClick={reopenDocument}>
        {message("action.reopenDocument")}
      </Button>
      <Button onClick={closeWindow}>{message("action.closeWindow")}</Button>
    </ErrorDialog>
  );
}
