import { useNavigate } from "react-router-dom";

import { Button } from "@shift/ui";
import { routes } from "@/app/routes";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";

export const NavigationPane = () => {
  const navigate = useNavigate();
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
              <Button
                key={route.id}
                icon={<Icon width={20} height={20} className="text-primary" />}
                aria-label={route.description}
                variant="ghost"
                size="icon"
                onClick={onClick}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
};
