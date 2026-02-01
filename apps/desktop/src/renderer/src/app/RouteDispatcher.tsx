import { useLocation } from "react-router-dom";
import { Landing } from "@/views/Landing";
import { FontInfo } from "@/views/FontInfo";
import { WorkspaceLayout } from "./WorkspaceLayout";

export const RouteDispatcher = () => {
  const { pathname } = useLocation();

  switch (pathname) {
    case "/":
      return <Landing />;
    case "/info":
      return <FontInfo />;
    default:
      return <WorkspaceLayout />;
  }
};
