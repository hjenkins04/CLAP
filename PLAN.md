# CLAP - LiDAR Segmentation Application

## Implementation Plan

### Phase 1: Foundation (Current)

- [x] Research & architecture planning
- [x] Build prerequisites (potree-core, PotreeConverter, convert test LAS)
- [x] Scaffold project (directory structure, package.json, configs)
- [x] Copy design system from helios-portal (13 components)
- [x] Electron setup (main, preload, IPC)
- [x] App shell (providers, router, layout)
- [x] Three.js + Potree viewer feature (ViewerEngine, hooks, components)
- [x] Wire up viewer controls (point size, budget, color mode, EDL)
- [ ] Test with converted point cloud (runtime verification needed)

### Phase 2: Segmentation Tooling (Future)

- [ ] Point selection tools (lasso, box, brush)
- [ ] Label management (create, edit, delete labels)
- [ ] Classification assignment workflow
- [ ] Undo/redo system
- [ ] Export labeled data

### Phase 3: Production Features (Future)

- [ ] Multi-file project management
- [ ] LAS-to-Potree conversion within the app (spawn PotreeConverter)
- [ ] Keyboard shortcuts & command palette
- [ ] Performance profiling & adaptive point budget
- [ ] Settings persistence

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 39 |
| UI Framework | React 19 |
| Build | Vite 7 |
| 3D Engine | Three.js 0.154 + potree-core |
| Routing | TanStack Router (hash-based) |
| Client State | Zustand |
| Server State | TanStack Query |
| Styling | Tailwind CSS 4 + CVA |
| Components | shadcn/ui (from helios-portal design system) |

## Project Structure

```
clap-app/
├── electron/
│   ├── main/
│   │   ├── index.ts              # App entry, lifecycle
│   │   ├── window.ts             # BrowserWindow creation
│   │   └── ipc.ts                # IPC handler registration
│   ├── preload/
│   │   └── index.ts              # Context bridge
│   └── shared/
│       ├── channels.ts           # IPC channel constants
│       └── types.ts              # Shared IPC types
├── libs/
│   └── design-system/
│       └── src/
│           ├── components/       # shadcn components
│           ├── hooks/            # use-mobile
│           ├── primitives/       # Radix Slot
│           ├── utils/            # cn() utility
│           ├── types/
│           └── index.ts          # Barrel export
├── src/
│   ├── app/
│   │   ├── providers/
│   │   │   ├── theme-provider.tsx
│   │   │   ├── query-provider.tsx
│   │   │   └── index.ts
│   │   ├── router/
│   │   │   ├── router.tsx
│   │   │   └── routes/
│   │   │       ├── __root.tsx
│   │   │       └── index.tsx     # Viewer page
│   │   └── stores/
│   │       ├── ui-store.ts
│   │       └── viewer-store.ts
│   ├── features/
│   │   └── viewer/
│   │       ├── components/
│   │       │   ├── viewer-canvas.tsx
│   │       │   ├── viewer-toolbar.tsx
│   │       │   └── viewer-sidebar-panel.tsx
│   │       ├── hooks/
│   │       │   ├── use-viewer-engine.ts
│   │       │   └── use-point-cloud.ts
│   │       ├── services/
│   │       │   └── viewer-engine.ts    # Three.js + Potree engine
│   │       ├── types/
│   │       │   └── viewer.types.ts
│   │       └── index.ts
│   ├── shared/
│   │   ├── components/
│   │   │   ├── app-layout.tsx
│   │   │   └── error-boundary.tsx
│   │   ├── lib/
│   │   │   └── logger.ts
│   │   └── hooks/
│   ├── config/
│   │   └── env.ts
│   ├── types/
│   │   └── electron.d.ts
│   ├── main.tsx
│   ├── styles.css
│   └── vite-env.d.ts
├── public/
│   └── pointclouds/              # Converted potree data
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.base.json
├── tsconfig.app.json
├── vite.config.mts
├── CLAUDE.md
└── PLAN.md
```

## Architecture Patterns

### Feature-Based Organization
Each feature is a complete vertical slice:
- `components/` - Presentational React components
- `hooks/` - Custom hooks (data, logic)
- `services/` - Business logic, API abstraction
- `types/` - TypeScript types
- `index.ts` - Barrel export (public API)

### ViewerEngine Pattern
The Three.js/Potree engine is a plain TypeScript class, NOT a React component.
React hooks provide the bridge between the imperative engine and declarative React.

### Provider Chain
```
ErrorBoundary > ThemeProvider > QueryProvider > RouterProvider > Toaster
```

### State Management
- **Zustand** for client state (theme, viewer settings)
- **TanStack Query** for async data (future API calls)
- **ViewerEngine** owns its own Three.js state (scene, camera, renderer)

## Potree Integration

- `potree-core` linked via `"file:../potree-core"` in package.json
- potree-core must be pre-built (`npm run build` produces `dist/index.js`)
- Three.js pinned to ~0.154.0 for compatibility
- Point clouds loaded from `public/pointclouds/` in dev
- PotreeConverter converts .las to v2 format (metadata.json + octree.bin + hierarchy.bin)
