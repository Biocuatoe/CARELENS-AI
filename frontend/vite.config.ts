import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { injectBridgeUrlPlugin } from "./scripts/inject-bridge-url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: { port: 4173, strictPort: true },
  define: {
    // Expose bridge URL for production build
    "import.meta.env.VITE_BRIDGE_PUBLIC_URL": JSON.stringify(
      process.env.VITE_BRIDGE_PUBLIC_URL ?? "",
    ),
  },
  build: {
    rollupOptions: {
      plugins: [
        // Inject bridge URL into built index.html
        injectBridgeUrlPlugin(process.env.VITE_BRIDGE_PUBLIC_URL),
      ],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
