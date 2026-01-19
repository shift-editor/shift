import { FC } from "react";

import { useNavigate } from "react-router-dom";

import { routes } from "@/app/routes";
import { Svg } from "@/types/common";

export interface NavigationItemProps {
  Icon: Svg;
  onClick: () => void;
}
export const NavigationItem: FC<NavigationItemProps> = ({ Icon, onClick }) => {
  return (
    <div
      className="h-fit w-fit rounded-sm p-1 hover:bg-toolbar-hover"
      onClick={onClick}
    >
      <Icon width={26} height={26} className="text-primary" />
    </div>
  );
};
export const NavigationPane = () => {
  const navigate = useNavigate();

  return (
    <section className="flex-1">
      <div className="mt-4 ml-4 flex flex-1 items-center">
        {routes.map((route) => {
          if (route.icon) {
            return (
              <NavigationItem
                key={route.id}
                Icon={route.icon}
                onClick={() => navigate(route.path)}
              />
            );
          }
          return null;
        })}
      </div>
    </section>
  );
};
