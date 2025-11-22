import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './styles/print.css';

import { router } from './app/routes';

type RouterProviderFutureProps = React.ComponentProps<typeof RouterProvider> & {
  future?: { v7_startTransition?: boolean };
};

const RouterProviderWithFuture = RouterProvider as React.ComponentType<RouterProviderFutureProps>;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const UI_SCALE_STORAGE_KEY = 'stockwise.ui-scale';
const UI_SCALE_DEFAULT = 1.1;
const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.6;
const UI_SCALE_STEP = 0.05;
const UI_SCALE_INDICATOR_ID = 'ui-scale-indicator';

let currentUiScale = UI_SCALE_DEFAULT;

const clampUiScale = (value: number): number => Math.min(Math.max(value, UI_SCALE_MIN), UI_SCALE_MAX);

const readStoredUiScale = (): number => {
  if (typeof window === 'undefined') {
    return UI_SCALE_DEFAULT;
  }

  const raw = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
  if (!raw) {
    return UI_SCALE_DEFAULT;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampUiScale(parsed) : UI_SCALE_DEFAULT;
};

const writeUiScale = (value: number): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, value.toString());
  } catch {
    // ignore write errors in environments that disallow storage
  }
};

const applyUiScale = (scale: number, options: { persist?: boolean } = { persist: true }): number => {
  const normalized = clampUiScale(scale);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--ui-scale', normalized.toString());
  }

  currentUiScale = normalized;

  if (options.persist !== false) {
    writeUiScale(normalized);
  }

  if (typeof document !== 'undefined') {
    const indicator = document.getElementById(UI_SCALE_INDICATOR_ID);
    if (indicator) {
      indicator.textContent = `${Math.round(normalized * 100)}%`;
    }
  }

  return normalized;
};

const initializeUiScale = (): void => {
  applyUiScale(readStoredUiScale(), { persist: false });
};

const registerUiScaleShortcuts = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    const isZoomModifier = event.ctrlKey || event.metaKey;
    if (!isZoomModifier) {
      return;
    }

    if (
      event.key === '+' ||
      event.key === '=' ||
      event.key === '_' ||
      event.key === '-' ||
      event.key === '0'
    ) {
      event.preventDefault();
    }

    if (event.key === '+' || event.key === '=') {
      applyUiScale(currentUiScale + UI_SCALE_STEP);
    } else if (event.key === '-' || event.key === '_') {
      applyUiScale(currentUiScale - UI_SCALE_STEP);
    } else if (event.key === '0') {
      applyUiScale(UI_SCALE_DEFAULT);
    }
  };

  const handleWheel = (event: WheelEvent): void => {
    const isZoomModifier = event.ctrlKey || event.metaKey;
    if (!isZoomModifier || event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    applyUiScale(currentUiScale + direction * UI_SCALE_STEP);
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('wheel', handleWheel, { passive: false });
};

function isLocalModeEnabled(): boolean {
  const flag = (import.meta.env?.VITE_FEATURE_LOCAL_MODE ?? 'false') as string | boolean;
  return String(flag).toLowerCase() === 'true';
}

async function enableMocking() {
  if (!isLocalModeEnabled()) {
    return;
  }

  try {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  } catch (error) {
    console.error('Failed to start the mock service worker.', error);
  }
}

function renderApp(rootElement: HTMLElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProviderWithFuture router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

async function bootstrap() {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Could not find root element to mount to');
  }

  initializeUiScale();
  registerUiScaleShortcuts();

  await enableMocking();
  renderApp(rootElement);
}

void bootstrap();
