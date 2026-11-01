import { createContext, useContext, useRef, type RefObject } from "react";

const SidebarBlockContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * One group of the selection's sections. An empty group, whose section has
 * nothing to show, is hidden, and a group is divided from a shown one before it.
 * Panels its fields open sit beside it ({@link useSidebarBlock}).
 */
export const SidebarGroup = ({ children }: { readonly children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <SidebarBlockContext.Provider value={ref}>
      <div
        ref={ref}
        data-sidebar-group=""
        className="flex flex-col gap-4 px-3 py-3 empty:hidden [[data-sidebar-group]:not(:empty)~&]:border-t [[data-sidebar-group]:not(:empty)~&]:border-line-subtle"
      >
        {children}
      </div>
    </SidebarBlockContext.Provider>
  );
};

/**
 * The sidebar group a field sits in, which its panels open beside: their
 * edge on the sidebar's, their top on the divider above the group.
 *
 * @returns null outside a {@link SidebarGroup}.
 */
export function useSidebarBlock(): RefObject<HTMLDivElement | null> | null {
  return useContext(SidebarBlockContext);
}
