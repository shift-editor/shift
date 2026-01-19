import { useNavigate } from "react-router-dom";

import { Button } from "@shift/ui";
import { routes } from "@/app/routes";

export const NavigationPane = () => {
  const navigate = useNavigate();

  return (
    <section className="flex-1">
      <div className="flex flex-1 items-center">
        <div className="bg-white rounded-lg border-b border-line">
          {routes.map((route) => {
            if (route.icon) {
              const Icon = route.icon;
              return (
                <Button
                  key={route.id}
                  icon={<Icon width={26} height={26} className="text-primary" />}
                  aria-label={route.description}
                  variant="toolbar"
                  size="icon"
                  className="h-10 w-10 p-1.5"
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
