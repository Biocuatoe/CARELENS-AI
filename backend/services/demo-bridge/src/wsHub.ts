import { WebSocketServer, WebSocket } from 'ws';
import type { StateStore } from './stateStore.js';

interface Client {
  ws: WebSocket;
  persona: string;
}

const WHITELIST_PERSONAS = new Set(['u_minh', 'u_lan', 'u_tuan']);

export class WsHub {
  private clients = new Map<WebSocket, Client>();

  constructor(private port: number, private stateStore?: StateStore) {}

  start(): void {
    const wss = new WebSocketServer({ port: this.port, path: '/ws' });

    wss.on('connection', (ws, req) => {
      // Auth: client must send {type:'hello', persona:'...'} within 3s
      const timer = setTimeout(() => ws.close(1008, 'Auth timeout'), 3000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'hello') {
            if (!WHITELIST_PERSONAS.has(msg.persona)) {
              ws.close(1008, 'Unknown persona');
              return;
            }
            clearTimeout(timer);
            this.clients.set(ws, { ws, persona: msg.persona });
            ws.send(JSON.stringify({ type: 'connected', persona: msg.persona }));
            console.log(`Client connected: ${msg.persona}`);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        clearTimeout(timer);
        this.clients.delete(ws);
      });
      ws.on('error', () => ws.close());
    });

    console.log(`WS hub listening on ws://0.0.0.0:${this.port}/ws`);
  }

  async broadcast(payload: string): Promise<number> {
    let count = 0;
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    }
    // After sending to WS clients, propagate the state change to SSE clients too.
    // This ensures Telegram → WS client → adapter flow also triggers SSE broadcast.
    this.stateStore?.broadcast();
    return count;
  }
}
