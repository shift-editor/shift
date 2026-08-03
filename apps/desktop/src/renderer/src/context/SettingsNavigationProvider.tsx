import { useCallback, useMemo, useState, type ReactNode } from "react";
import { SettingsDialog } from "@/components/chrome/settings/SettingsDialog";
import type { SettingsTarget } from "@/types/settings";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { SettingsNavigationContext, type SettingsNavigation } from "./SettingsNavigationContext";

export const SettingsNavigationProvider = ({ children }: { children: ReactNode }) => {
  const workspace = useFontSession().workspace;
  const [target, setTarget] = useState<SettingsTarget | null>(null);
  const open = useCallback((next: SettingsTarget) => setTarget(next), []);
  const navigation = useMemo<SettingsNavigation>(() => ({ open }), [open]);

  return (
    <SettingsNavigationContext.Provider value={navigation}>
      {children}
      {workspace ? (
        <SettingsDialog
          target={target}
          onTargetChange={setTarget}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      ) : null}
    </SettingsNavigationContext.Provider>
  );
};
