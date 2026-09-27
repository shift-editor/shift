import { createContext, useContext, type ReactNode } from "react";

const PortalContainerContext = createContext<HTMLElement | null>(null);

export interface PortalContainerProviderProps {
  /** Element that popups, menus, and tooltips mount into; `null` falls back to `<body>`. */
  container: HTMLElement | null;
  children: ReactNode;
}

/** Mounts every `@shift/ui` portal inside `container`, so embedded UI stays within its style scope. */
export function PortalContainerProvider({ container, children }: PortalContainerProviderProps) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  );
}

/** Returns the provided portal container, or `undefined` to use Base UI's `<body>` default. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
