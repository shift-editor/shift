import { useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { getShiftHost } from "@/host/shiftHost";

/**
 * Matches the native window controls to the resolved theme.
 *
 * @param enabled - whether this window has native controls to recolour.
 * @param backgroundToken - CSS colour token behind the controls.
 */
export function useTitleBarColors(enabled: boolean, backgroundToken = "--color-chrome"): void {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!enabled) return;

    const style = getComputedStyle(document.documentElement);
    const background = style.getPropertyValue(backgroundToken).trim();
    const symbol = style.getPropertyValue("--color-primary").trim();
    if (!background || !symbol) return;

    void setTitleBarColors(background, symbol);
  }, [backgroundToken, enabled, resolvedTheme]);
}

async function setTitleBarColors(background: string, symbol: string): Promise<void> {
  try {
    await getShiftHost().window.setTitleBarColors({ background, symbol });
  } catch (error) {
    console.error("recolouring window controls failed", error);
  }
}
