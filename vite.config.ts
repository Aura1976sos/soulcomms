import { defineConfig, PluginOption } from "vite";
import { enterDevPlugin, enterProdPlugin } from 'vite-plugin-enter-dev';
import { VitePWA } from 'vite-plugin-pwa';
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const plugins = [
    ...enterProdPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Soulcomms',
        short_name: 'Soulcomms',
        description: 'Multi-event check-in and activity management',
        theme_color: '#e81c1c',
        background_color: '#0d0d0d',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/favicon.ico', sizes: '64x64', type: 'image/x-icon' },
        ],
      },
      workbox: {
        skipWaiting: true,       // activate new SW immediately (no waiting for tabs to close)
        clientsClaim: true,      // take control of all existing clients instantly
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6 MiB
      },
    }),
  ];
  if (mode === 'development') {
    plugins.push(...enterDevPlugin());
  }
  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: plugins.filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // scheduler@0.26.0 has no exports field — this shim provides the full API.
        "scheduler": path.resolve(__dirname, "./src/shims/scheduler.cjs"),
      },
      // Force a single instance of every package that uses React's internal
      // singleton (ReactSharedInternals). Without this, pnpm's virtual store
      // can resolve multiple copies of react/react-dom across lazy chunks,
      // leaving ReactSharedInternals.H (the hooks dispatcher) null in some
      // chunks and causing: "Cannot read properties of null (reading 'useState')"
      dedupe: [
        "react", "react-dom", "react-router-dom",
        "react-i18next", "@tanstack/react-query",
      ],
    },
    base: '/',
    build: {
      outDir: 'dist',
    },
  };
});