// Vite config for the CareLens AI pitch-video composition.
// The composition is a small standalone page. It imports the real landing code (3D hardware assembly, care scenes, brand, content, tokens)
// from ../../frontend/src via the "@fe" alias, so the video always reuses the product's own assets. Dependencies (react, three, tailwind)
// are resolved from ../../frontend/node_modules, so run `npm ci` in frontend/ first.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fe = path.resolve(here, "../../frontend");
const req = createRequire(path.join(fe, "package.json"));
const load = async (name) => (await import(pathToFileURL(req.resolve(name)).href)).default;

const react = await load("@vitejs/plugin-react");
const tailwind = await load("@tailwindcss/vite");
const nm = (p) => path.join(fe, "node_modules", p);

export default {
  root: here,
  publicDir: path.join(here, "public"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@fe", replacement: path.join(fe, "src") },
      { find: /^react$/, replacement: nm("react") },
      { find: /^react\/(.*)$/, replacement: nm("react") + "/$1" },
      { find: /^react-dom$/, replacement: nm("react-dom") },
      { find: /^react-dom\/(.*)$/, replacement: nm("react-dom") + "/$1" },
      { find: /^three$/, replacement: nm("three") },
      { find: /^three\/(.*)$/, replacement: nm("three") + "/$1" },
      { find: /^lucide-react$/, replacement: nm("lucide-react") },
    ],
  },
  server: { port: 5199, strictPort: true, fs: { allow: [path.resolve(here, "../..")] } },
  clearScreen: false,
};
