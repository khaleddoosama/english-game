import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Installable app + offline shell. Game data offline comes from the
    // repo's IndexedDB cache; the service worker adds the app files, fonts,
    // pictures and pronunciation audio.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Word Hunter",
        short_name: "Word Hunter",
        description: "English vocabulary detective game — practice, stories, and live challenges with friends.",
        theme_color: "#1c1a17",
        background_color: "#1c1a17",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 30, maxAgeSeconds: 31536000 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // Word pictures and pronunciation audio (content-hashed, never change).
            urlPattern: /\/storage\/v1\/object\/public\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "media", expiration: { maxEntries: 600, maxAgeSeconds: 2592000 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /^https:\/\/api\.dictionaryapi\.dev\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "dictionary", expiration: { maxEntries: 400, maxAgeSeconds: 2592000 } },
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than the game: their own chunks
        // stay cached across deploys.
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "supabase", test: /node_modules[\\/]@supabase[\\/]/ },
            { name: "icons", test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,jsx}"],
  },
});
