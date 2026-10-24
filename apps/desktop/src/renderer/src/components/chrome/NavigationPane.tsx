import { Button, Tooltip } from "@shift/ui";
import InfoIcon from "@/assets/toolbar/info.svg";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { WindowTabsBar } from "./WindowTabsBar";

/** The title bar's navigation: the window's tabs, then Settings. */
export const NavigationPane = () => {
  const settings = useSettingsNavigation();

  return (
    <section className="flex h-full min-w-0 flex-1 items-center gap-1">
      <WindowTabsBar />
      <Tooltip content="Settings" side="bottom" sideOffset={5}>
        <Button
          icon={<InfoIcon width={18} height={18} />}
          aria-label="Settings"
          variant="toolbar"
          isActive={settings.target !== null}
          size="icon-sm"
          className="h-7 w-7 shrink-0"
          onClick={() => settings.open({ category: "font" })}
        />
      </Tooltip>
    </section>
  );
};
