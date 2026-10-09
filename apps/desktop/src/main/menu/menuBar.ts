import type { MenuItemConstructorOptions } from "electron";
import type { MenuBar, MenuBarItem } from "../../shared/menu/types";

type MenuRole = NonNullable<MenuItemConstructorOptions["role"]>;

/** Labels and accelerators Electron supplies for the roles Shift's Windows and Linux menus use. */
const ROLE_DEFAULTS: Partial<Record<MenuRole, { label: string; accelerator?: string }>> = {
  quit: { label: "Quit", accelerator: "CmdOrCtrl+Q" },
  reload: { label: "Reload", accelerator: "CmdOrCtrl+R" },
  forceReload: { label: "Force Reload", accelerator: "Shift+CmdOrCtrl+R" },
  toggleDevTools: { label: "Toggle Developer Tools", accelerator: "CmdOrCtrl+Shift+I" },
  help: { label: "Help" },
};

/**
 * Gives every template entry a stable `id` so the drawn menu can activate it.
 *
 * @remarks
 * Command items already carry their command id. Everything else (roles, Open
 * Recent entries, nested submenus) gets a path-based id such as `menu.0.4.1`.
 * Electron requires ids to be unique within a menu.
 *
 * @returns a copy of the template; the input is not modified.
 */
export function withMenuItemIds(
  template: readonly MenuItemConstructorOptions[],
  parentId = "menu",
): MenuItemConstructorOptions[] {
  return template.map((item, index) => {
    const id = item.id ?? `${parentId}.${index}`;
    const submenu = Array.isArray(item.submenu) ? withMenuItemIds(item.submenu, id) : item.submenu;
    return { ...item, id, ...(submenu === undefined ? {} : { submenu }) };
  });
}

/**
 * Describes an installed Windows or Linux menu template for the renderer.
 *
 * @param template - the template main installed, with ids from {@link withMenuItemIds}.
 * @param isEnabled - the current enabled state of an installed item, by id.
 */
export function menuBarFromTemplate(
  template: readonly MenuItemConstructorOptions[],
  isEnabled: (id: string) => boolean,
): MenuBar {
  return template.flatMap((item) => menuBarItem(item, isEnabled, true));
}

/**
 * Formats an Electron accelerator the way Windows and Linux menus show it.
 *
 * @example `CmdOrCtrl+Shift+O` becomes `Ctrl+Shift+O`; `CmdOrCtrl+Plus` becomes `Ctrl++`.
 */
export function acceleratorLabel(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => {
      switch (part) {
        case "CmdOrCtrl":
        case "CommandOrControl":
          return "Ctrl";
        case "Plus":
          return "+";
        default:
          return part;
      }
    })
    .join("+");
}

function menuBarItem(
  item: MenuItemConstructorOptions,
  isEnabled: (id: string) => boolean,
  topLevel: boolean,
): MenuBarItem[] {
  const id = item.id;
  if (!id) throw new Error("menu item is missing an id; build the template with withMenuItemIds");
  if (item.visible === false) return [];
  if (item.type === "separator") return [{ kind: "separator", id }];

  const defaults = item.role ? ROLE_DEFAULTS[item.role] : undefined;
  const label = item.label ?? defaults?.label;
  if (!label) throw new Error(`menu item ${id} has no label`);

  if (Array.isArray(item.submenu)) {
    return [
      {
        kind: "submenu",
        id,
        label,
        accessKey: topLevel ? label.charAt(0).toUpperCase() : null,
        enabled: isEnabled(id),
        items: item.submenu.flatMap((child) => menuBarItem(child, isEnabled, false)),
      },
    ];
  }

  const accelerator =
    typeof item.accelerator === "string" ? item.accelerator : defaults?.accelerator;
  return [
    {
      kind: "command",
      id,
      label,
      shortcut: accelerator ? acceleratorLabel(accelerator) : null,
      enabled: isEnabled(id),
    },
  ];
}
