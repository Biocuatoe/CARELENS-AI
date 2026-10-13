/**
 * Vite plugin that injects the bridge URL into the built index.html.
 * After build, if VITE_BRIDGE_PUBLIC_URL env is set, the script injects:
 *   window.__BRIDGE_URL__ = "..."
 * into index.html so the app auto-connects to the cloud bridge on Cloud Run.
 */

import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function injectBridgeUrlPlugin(bridgeUrl?: string): Plugin {
  return {
    name: 'inject-bridge-url',
    enforce: 'post',

    // For production build: inject into index.html after transformation
    transformIndexHtml: {
      order: 'post',
      handler: (html: string): string => {
        if (!bridgeUrl) {
          return html;
        }

        const script = `<script>window.__BRIDGE_URL__=${JSON.stringify(bridgeUrl)};</script>`;

        // Inject before closing </head> tag
        return html.replace('</head>', `${script}\n</head>`);
      },
    },

    // Write hook: inject into built index.html after output is written
    writeBundle: {
      order: 'post',
      async handler(options, bundle) {
        if (!bridgeUrl) {
          return;
        }

        // Find the index.html in the output
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName.endsWith('index.html') && chunk.type === 'asset') {
            const filePath = resolve(options.dir ?? 'dist', fileName);
            const content = await readFile(filePath, 'utf-8');

            const script = `<script>window.__BRIDGE_URL__=${JSON.stringify(bridgeUrl)};</script>`;
            const updated = content.replace('</head>', `${script}\n</head>`);

            await writeFile(filePath, updated, 'utf-8');
            console.log(`[inject-bridge-url] Injected bridge URL into ${fileName}`);
            break;
          }
        }
      },
    },
  };
}
