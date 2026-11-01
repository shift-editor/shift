import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SettingsDialog } from "@/components/chrome/settings/SettingsDialog";
import { ComponentPickerDialog } from "@/components/editor/ComponentPickerDialog";
import { getShiftHost } from "@/host/shiftHost";
import { runRendererCommand } from "@/lib/commands/rendererCommands";
import type { SettingsTarget } from "@/types/settings";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import { SettingsNavigationContext, type SettingsNavigation } from "./SettingsNavigationContext";

export const SettingsNavigationProvider = ({ children }: { children: ReactNode }) => {
  const session = useFontSession();
  const { closeShown } = useWindowTabs();
  const [target, setTarget] = useState<SettingsTarget | null>(null);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const open = useCallback((next: SettingsTarget) => setTarget(next), []);
  const navigation = useMemo<SettingsNavigation>(() => ({ open, target }), [open, target]);

  useEffect(
    () =>
      getShiftHost().commands.onRunRendererCommand(async (id) => {
        if (id === "app.showSettings") {
          setTarget({ category: "font" });
          return;
        }
        if (id === "tab.close") {
          // Only the pinned Glyphs tab is left: Close Tab closes the window, prompting as usual.
          if (!closeShown()) await getShiftHost().commands.run("window.close");
          return;
        }
        if (id === "glyph.addComponent") {
          if (session.mode === "workspace" && session.editor.scene.only("glyph") !== null) {
            setComponentPickerOpen(true);
          }
          return;
        }

        try {
          await runRendererCommand(session.editor, id);
        } catch (error) {
          console.error("renderer command failed", id, error);
        }
      }),
    [closeShown, session.editor, session.mode],
  );

  return (
    <SettingsNavigationContext.Provider value={navigation}>
      {children}
      <ComponentPickerDialog open={componentPickerOpen} onOpenChange={setComponentPickerOpen} />
      <SettingsDialog
        target={target}
        canAuthor={session.mode === "workspace"}
        onTargetChange={setTarget}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </SettingsNavigationContext.Provider>
  );
};
