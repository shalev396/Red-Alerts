/**
 * The app's single runtime entry point for maplibre-gl - import `maplibregl`
 * from here, never as a value from 'maplibre-gl' directly (type-only imports
 * are fine).
 *
 * maplibre-gl v6 is ESM-only and, under a bundler, cannot locate its worker
 * from import.meta.url, so every map would load no tiles. `?worker&url` makes
 * Vite bundle the worker (including its maplibre-gl-shared.mjs import) into a
 * self-contained chunk; registering it here, at module load, guarantees it is
 * set before any Map is constructed.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

export * as maplibregl from 'maplibre-gl';
