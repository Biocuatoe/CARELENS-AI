import pino from 'pino';
import { createBot, startBot } from './bot.js';
import { WsHub } from './wsHub.js';
import { StateStore } from './stateStore.js';
import { createSseRouter } from './sseServer.js';
import { config } from './config.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve state.json to the directory containing this script (project root)
const STATE_PATH = join(__dirname, '..', '..', 'state.json');

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  logger.info({ mode: config.bridgeMode, port: config.port }, 'Starting bridge service');

  // Initialise state store before everything else
  const stateStore = new StateStore(STATE_PATH);

  const hub = new WsHub(config.port, stateStore);
  hub.start();

  const bot = createBot(hub, stateStore);
  await startBot(bot);

  // SSE router for web clients
  const sseHandler = createSseRouter(stateStore);

  // HTTP server: health, SSE, Telegram webhook
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    // Delegate SSE to its router
    if (req.url?.startsWith('/api/demo/stream')) {
      sseHandler(req, res);
      return;
    }

    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else if (req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'demo-bridge', version: '0.1.0', mode: config.bridgeMode }));
    } else if (req.url === '/telegram/webhook' && req.method === 'POST' && config.bridgeMode === 'webhook') {
      // Let grammY handle the webhook
      res.writeHead(200);
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(config.port, () => {
    logger.info(`HTTP server on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    bot.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
