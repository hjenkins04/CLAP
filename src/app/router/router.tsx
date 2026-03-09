import { createRouter, createHashHistory } from '@tanstack/react-router';
import { rootRoute } from './routes/__root';
import { viewerRoute } from './routes/index';

const routeTree = rootRoute.addChildren([viewerRoute]);

const history = createHashHistory();

export const router = createRouter({
  routeTree,
  history,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
