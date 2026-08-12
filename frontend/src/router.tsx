import { QueryClient } from "@tanstack/react-query";
import { createRouter, createHashHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    // Hash history: GitHub Pages has no server to rewrite unknown URLs to
    // index.html, so we keep the route in the hash fragment to avoid 404s on
    // refresh/deep links. (There is only one route here, but this is what
    // makes a multi-route SPA safe on a static host too.)
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
