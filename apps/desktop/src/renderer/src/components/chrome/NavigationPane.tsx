import { useLocation, useNavigate } from "react-router";

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { routes } from "@/app/routes";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";

export const NavigationPane = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettingsNavigation();

  return (
    <section className="h-full flex flex-1 items-center ml-1">
      <div className="flex flex-1 items-center">
        <div className="bg-white rounded-lg border-b border-line p-0.5">
          {routes.map((route) => {
            if (!route.icon) return null;
            const Icon = route.icon;

            const onClick = () => {
              switch (route.kind) {
                case "route":
                  navigate(route.path);
                  return;
                case "dialog":
                  if (route.dialogId === "settings") {
                    settings.open({ category: "font" });
                  }
                  return;
              }
            };

            return (
              <Tooltip key={route.id}>
                <TooltipTrigger>
                  <Button
                    icon={<Icon width={20} height={20} className="text-primary" />}
                    aria-label={route.description}
                    variant="ghost"
                    isActive={
                      route.kind === "dialog"
                        ? settings.target !== null
                        : settings.target === null && location.pathname === route.path
                    }
                    size="icon"
                    onClick={onClick}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={5}>
                  {route.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </section>
  );
};
