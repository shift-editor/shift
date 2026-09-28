import { createContext, useContext } from "react";

/**
 * Host hooks fired while a sidebar input is being edited.
 *
 * Hosts with their own keyboard routing use these to keep shortcuts from
 * reaching the canvas mid-edit. Embedders without one can omit the provider.
 */
export interface SidebarInputFocusHandlers {
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const SidebarInputFocusContext = createContext<SidebarInputFocusHandlers | null>(null);

export const SidebarInputFocusProvider = SidebarInputFocusContext.Provider;

export function useSidebarInputFocus(): SidebarInputFocusHandlers | null {
  return useContext(SidebarInputFocusContext);
}
