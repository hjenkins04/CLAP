# Claude Code Instructions

## Project Overview

**CLAP** (Cloud LiDAR Annotation Platform) is a desktop LiDAR point cloud segmentation and labeling application built with:

- **React 19** - UI Framework
- **Electron** - Desktop platform
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Three.js + potree-core** - 3D point cloud rendering
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library (in libs/design-system)

## Critical Rules

### ALWAYS Do

1. **Follow feature structure** - Each feature is a complete vertical slice:
   ```
   feature/
   ├── components/     # Presentational React components
   ├── hooks/          # Custom hooks (data, logic)
   ├── services/       # Business logic, engine abstraction
   ├── types/          # TypeScript types
   └── index.ts        # Barrel export (public API)
   ```

2. **Use design system** - Import UI from `@clap/design-system`
3. **Use Zustand** for client state, **TanStack Query** for server state
4. **Keep ViewerEngine as plain TypeScript** - Not a React component
5. **Handle errors properly** - Log and display user-friendly messages

### NEVER Do

1. No `any` type - use `unknown` with type guards
2. No cross-feature imports - use shared layer
3. No business logic in components - extract to services/hooks
4. No inline styles - use Tailwind or CVA
5. No `console.log` in production code

## Import Aliases

```typescript
import { Button } from '@clap/design-system';  // Design system
import { cn } from '@ds/utils';                 // Internal DS utility
import { useViewerStore } from '@/app/stores';  // App stores
import { ViewerPage } from '@/features/viewer'; // Features
```

## State Management

| Type         | Solution       |
| ------------ | -------------- |
| UI state     | Zustand        |
| Viewer state | Zustand        |
| Server data  | TanStack Query |
| 3D engine    | ViewerEngine class (imperative) |

## Architecture

- **ViewerEngine** owns Three.js scene, camera, renderer, Potree instances
- React hooks bridge the engine to the component tree
- Point clouds are loaded from potree octree format (metadata.json)
- PotreeConverter converts .las files to octree format

## Key Paths

- `src/features/viewer/services/viewer-engine.ts` - Core 3D engine
- `src/app/stores/viewer-store.ts` - Viewer settings state
- `libs/design-system/` - shadcn component library
- `electron/` - Electron main process
- `public/pointclouds/` - Converted point cloud data
