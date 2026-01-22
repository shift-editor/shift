import { useNavigate } from "react-router-dom";

import { Button } from "@shift/ui";
import { routes } from "@/app/routes";

export const NavigationPane = () => {
  const navigate = useNavigate();

  return (
    <section className="h-full flex flex-1 items-center ml-1">
      <div className="flex flex-1 items-center">
        <div className="bg-white rounded-lg border-b border-line p-0.5">
          {routes.map((route) => {
            if (route.icon) {
              const Icon = route.icon;
              return (
                <Button
                  key={route.id}
                  icon={
                    <Icon width={20} height={20} className="text-primary" />
                  }
                  aria-label={route.description}
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(route.path)}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </section>
  );
};
