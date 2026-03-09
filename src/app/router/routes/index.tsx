import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ViewerPage } from '@/features/viewer';

export const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ViewerPage,
});
