import { useLocation } from "react-router-dom";
import { Landing } from "@/views/Landing";
import { WorkspaceLayout } from "./WorkspaceLayout";

export const RouteDispatcher = () => {
  const { pathname } = useLocation();

  switch (pathname) {
    case "/":
      return <Landing />;
    default:
      return <WorkspaceLayout />;
  }
};
