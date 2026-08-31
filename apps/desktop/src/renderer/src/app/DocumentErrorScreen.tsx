import { Button } from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";

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
    <main className="grid h-screen place-items-center bg-canvas p-8 text-primary">
      <section className="max-w-md space-y-4 rounded-lg border border-border bg-panel p-6 shadow-lg">
        <h1 className="text-lg font-semibold">
          This document encountered an unexpected interface error.
        </h1>
        <p className="text-sm text-secondary">Your completed edits have been preserved.</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={reopenDocument}>
            Reopen Document
          </Button>
          <Button onClick={closeWindow}>Close Window</Button>
        </div>
      </section>
    </main>
  );
}
