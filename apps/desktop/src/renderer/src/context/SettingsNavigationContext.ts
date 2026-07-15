import { createContext, useContext } from "react";
import type { SettingsTarget } from "@/types/settings";

export interface SettingsNavigation {
  open: (target: SettingsTarget) => void;
}

export const SettingsNavigationContext = createContext<SettingsNavigation | null>(null);

export function useSettingsNavigation(): SettingsNavigation {
  const navigation = useContext(SettingsNavigationContext);
  if (!navigation) {
    throw new Error("useSettingsNavigation must be used within a SettingsNavigationProvider");
  }

  return navigation;
}
