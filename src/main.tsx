import { StrictMode } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { HotkeysProvider } from '@tanstack/react-hotkeys';
import * as ReactDOM from 'react-dom/client';
import { Toaster } from '@clap/design-system';
import { router } from '@/app/router';
import { QueryProvider, ThemeProvider } from '@/app/providers';
import { ErrorBoundary } from '@/shared';
import './styles.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <StrictMode>
    <ErrorBoundary>
      <HotkeysProvider>
        <ThemeProvider>
          <QueryProvider>
            <RouterProvider router={router} />
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </HotkeysProvider>
    </ErrorBoundary>
  </StrictMode>
);
