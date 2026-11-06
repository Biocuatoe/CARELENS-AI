import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { injectBridgeUrlPlugin } from "./scripts/inject-bridge-url";

/**
 * Tên tệp tài sản trong bản build chỉ gồm ASCII. Ảnh trong `members/` có tên tiếng Việt có dấu; Vercel không khớp những tên đó với
 * hệ tệp và trả về trang index.html (text/html) thay vì ảnh, nên ảnh hỏng trên production dù chạy tốt ở dev và preview.
 */
function asciiAssetName(name: string | undefined, ext: string): string {
  const base = (name ?? "asset")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "asset"}-[hash]${ext}`;
}

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
      output: {
        assetFileNames: (asset) => {
          const file = asset.names?.[0] ?? asset.name;
          const dot = file ? file.lastIndexOf(".") : -1;
          return "assets/" + asciiAssetName(file, dot >= 0 ? file!.slice(dot).toLowerCase() : "");
        },
      },
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
