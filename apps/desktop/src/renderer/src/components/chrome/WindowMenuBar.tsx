import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Menu,
  Menubar,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuIcon,
  MenuTrigger,
} from "@shift/ui";
import type { MenuBar, MenuBarItem } from "@shared/menu/types";
import { getShiftHost } from "@/host/shiftHost";
import { menuForAccessKey, splitAccessKey } from "./menuBarKeys";
import { useTitleBarColors } from "./useTitleBarColors";

/**
 * File · Edit · View · Glyph · Help for Windows and Linux, drawn in the toolbar row.
 *
 * @remarks
 * Main owns the menus and sends them as a {@link MenuBar}; choosing an item asks
 * main to run it, so these menus and the native accelerators never disagree.
 * Tapping Alt or pressing F10 enters menu mode, which underlines access keys and
 * lets a letter open its menu; Alt+letter chords remain editor shortcuts.
 * Renders nothing on macOS, which keeps its native menu bar.
 *
 * @param collapsible - collapses the menus into a single ☰ menu when the window
 * is too narrow for them beside the editor's tools and title.
 */
export const WindowMenuBar = ({ collapsible = false }: { collapsible?: boolean }) => {
  const host = getShiftHost();
  const isMac = host.platform === "darwin";
  const bar = useMenuBar(!isMac);
  const compact = useNarrowWindow() && collapsible;
  const triggers = useRef(new Map<string, HTMLElement>());
  const [menuMode, setMenuMode] = useState(false);

  useTitleBarColors(!isMac);

  useEffect(() => {
    if (isMac) return undefined;

    let altTap = false;
    const focusFirstMenu = () => {
      const first = compact ? COMPACT_MENU_ID : bar.find((item) => item.kind === "submenu")?.id;
      if (first) triggers.current.get(first)?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        altTap = !event.repeat;
        return;
      }
      altTap = false;

      if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        setMenuMode(true);
        focusFirstMenu();
        return;
      }
      if (!menuMode) return;

      if (event.key === "Escape") {
        setMenuMode(false);
        return;
      }
      const menuId = compact ? null : menuForAccessKey(bar, event.key);
      if (!menuId) return;

      event.preventDefault();
      triggers.current.get(menuId)?.click();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !altTap) return;

      altTap = false;
      setMenuMode((active) => {
        if (!active) focusFirstMenu();
        return !active;
      });
    };
    const cancelAltTap = () => {
      altTap = false;
    };
    const leaveMenuMode = () => setMenuMode(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", cancelAltTap, true);
    window.addEventListener("blur", leaveMenuMode);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", cancelAltTap, true);
      window.removeEventListener("blur", leaveMenuMode);
    };
  }, [bar, compact, isMac, menuMode]);

  if (isMac || bar.length === 0) return null;

  const activate = async (itemId: string) => {
    setMenuMode(false);
    try {
      await host.menu.activate(itemId);
    } catch (error) {
      console.error("menu item failed", itemId, error);
    }
  };

  const registerTrigger = (id: string) => (element: HTMLElement | null) => {
    if (element) triggers.current.set(id, element);
    else triggers.current.delete(id);
  };

  if (compact) {
    return (
      <Menubar aria-label="Application menu" className="ml-2 h-full">
        <Menu modal={false}>
          <MenuTrigger
            ref={registerTrigger(COMPACT_MENU_ID)}
            variant="menubar"
            aria-label="Application menu"
          >
            <MenuIcon aria-hidden width={16} height={16} />
          </MenuTrigger>
          <MenuPortal>
            <MenuPositioner side="bottom" align="start" sideOffset={4}>
              <MenuPopup aria-label="Application menu" className="min-w-48">
                <MenuBarItems items={bar} onActivate={activate} />
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
      </Menubar>
    );
  }

  return (
    <Menubar aria-label="Application menu" className="ml-2 h-full">
      {bar.map((item) => {
        if (item.kind !== "submenu") return null;

        const [before, key, after] = splitAccessKey(item.label, item.accessKey);
        return (
          <Menu key={item.id} modal={false} disabled={!item.enabled}>
            <MenuTrigger ref={registerTrigger(item.id)} variant="menubar">
              {before}
              <span className={menuMode ? "underline underline-offset-2" : undefined}>{key}</span>
              {after}
            </MenuTrigger>
            <MenuPortal>
              <MenuPositioner side="bottom" align="start" sideOffset={4}>
                <MenuPopup aria-label={item.label} className="min-w-64">
                  <MenuBarItems items={item.items} onActivate={activate} />
                </MenuPopup>
              </MenuPositioner>
            </MenuPortal>
          </Menu>
        );
      })}
    </Menubar>
  );
};

const MenuBarItems = ({
  items,
  onActivate,
}: {
  items: readonly MenuBarItem[];
  onActivate: (itemId: string) => void;
}): ReactNode =>
  items.map((item) => {
    switch (item.kind) {
      case "separator":
        return <MenuSeparator key={item.id} />;
      case "command":
        return (
          <MenuItem
            key={item.id}
            disabled={!item.enabled}
            onClick={() => onActivate(item.id)}
            className="justify-between gap-6"
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <kbd className="font-sans text-sm text-muted">{item.shortcut}</kbd>
            ) : null}
          </MenuItem>
        );
      case "submenu":
        return (
          <MenuSubmenuRoot key={item.id} disabled={!item.enabled}>
            <MenuSubmenuTrigger>
              <span>{item.label}</span>
              <span aria-hidden className="text-muted">
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </MenuSubmenuTrigger>
            <MenuPortal>
              <MenuPositioner side="right" align="start" sideOffset={2}>
                <MenuPopup aria-label={item.label} className="min-w-56">
                  <MenuBarItems items={item.items} onActivate={onActivate} />
                </MenuPopup>
              </MenuPositioner>
            </MenuPortal>
          </MenuSubmenuRoot>
        );
    }
  });

const COMPACT_MENU_ID = "menu.compact";

/** Window width below which a collapsible menu bar shows a single ☰ menu. */
const NARROW_WINDOW_QUERY = "(max-width: 1279px)";

/** Whether the window is currently narrower than {@link NARROW_WINDOW_QUERY}. */
function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_WINDOW_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW_WINDOW_QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
}

/** Keeps the main-owned menus current while the window is open. */
function useMenuBar(enabled: boolean): MenuBar {
  const [bar, setBar] = useState<MenuBar>([]);

  useEffect(() => {
    if (!enabled) return undefined;

    const host = getShiftHost();
    let current = true;
    const unsubscribe = host.menu.onBarChanged((next) => setBar(next));
    void loadMenuBar(() => current, setBar);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [enabled]);

  return bar;
}

async function loadMenuBar(isCurrent: () => boolean, setBar: (bar: MenuBar) => void) {
  try {
    const bar = await getShiftHost().menu.bar();
    if (isCurrent()) setBar(bar);
  } catch (error) {
    console.error("loading the menu bar failed", error);
  }
}
