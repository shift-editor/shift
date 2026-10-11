import * as React from "react";
import { Menubar as BaseMenubar } from "@base-ui/react/menubar";
import { cn } from "../../lib/utils";

export interface MenubarProps extends React.ComponentProps<typeof BaseMenubar> {}

/**
 * A horizontal row of menus with keyboard navigation between them.
 *
 * @remarks
 * Place a `Menu` for each top-level menu inside it. Arrow keys move between the
 * menus' triggers and open menus follow the focused trigger.
 */
export function Menubar({ className, ...props }: MenubarProps) {
  return <BaseMenubar className={cn("flex items-center gap-0.5 px-1", className)} {...props} />;
}
