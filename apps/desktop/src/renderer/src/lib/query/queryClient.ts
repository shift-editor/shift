import { QueryClient } from "@tanstack/react-query";

export function createRendererQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
}

export const rendererQueryClient = createRendererQueryClient();
