import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SettingsDialog } from "@/components/chrome/settings/SettingsDialog";
import { getShiftHost } from "@/host/shiftHost";
import { runRendererCommand } from "@/lib/commands/rendererCommands";
import type { SettingsTarget } from "@/types/settings";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { SettingsNavigationContext, type SettingsNavigation } from "./SettingsNavigationContext";

export const SettingsNavigationProvider = ({ children }: { children: ReactNode }) => {
  const session = useFontSession();
  const [target, setTarget] = useState<SettingsTarget | null>(null);
  const open = useCallback((next: SettingsTarget) => setTarget(next), []);
  const navigation = useMemo<SettingsNavigation>(() => ({ open, target }), [open, target]);

  useEffect(
    () =>
      getShiftHost().commands.onRunRendererCommand(async (id) => {
        if (id === "app.showSettings") {
          setTarget({ category: "font" });
          return;
        }

        try {
          await runRendererCommand(session.editor, id);
        } catch (error) {
          console.error("renderer command failed", id, error);
        }
      }),
    [session.editor],
  );

  return (
    <SettingsNavigationContext.Provider value={navigation}>
      {children}
      <SettingsDialog
        target={target}
        canAuthor={session.mode === "authored"}
        onTargetChange={setTarget}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </SettingsNavigationContext.Provider>
  );
};
