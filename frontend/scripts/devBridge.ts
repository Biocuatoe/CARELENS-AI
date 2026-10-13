/**
 * Development script: connects the web app to the demo bridge via WebSocket.
 * This script exposes window.__demoBridge for the app to use.
 *
 * Commands from Telegram are received via WebSocket and translated to
 * DemoAdapter method calls. This runs only in development mode.
 */

import type { DemoControls } from '../src/data/adapter';

declare global {
  interface Window {
    __demoBridge?: {
      run: (cmd: string, args?: string[]) => Promise<string>;
      onCmd: (fn: (cmd: string, args: string[], chatId: string) => void) => void;
      connected: boolean;
    };
  }
}

const WS_URL = import.meta.env.VITE_BRIDGE_WS_URL ?? 'ws://localhost:8080/ws';

interface BridgeMessage {
  cmd: string;
  args: string[];
  chatId: string;
}

let ws: WebSocket | null = null;
let connected = false;
const pendingCallbacks: Array<(cmd: string, args: string[], chatId: string) => void> = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000;

// Get demo adapter from window - it should be set by the app
function getDemoAdapter(): DemoControls | null {
  // The app should expose this when running in demo mode
  return (window as unknown as { __demoAdapter?: DemoControls }).__demoAdapter ?? null;
}

// Get current recipient ID from the app
function getCurrentRecipientId(): string | null {
  return (window as unknown as { __currentRecipientId?: string }).__currentRecipientId ?? null;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[devBridge] Connected to bridge at', WS_URL);
      connected = true;
      reconnectAttempts = 0;

      // Auth with persona
      ws!.send(JSON.stringify({ type: 'hello', persona: 'u_minh' }));
      updateConnectedState(true);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as BridgeMessage;

        if (msg.cmd) {
          // Process command
          console.log('[devBridge] Received command:', msg.cmd, msg.args);

          const adapter = getDemoAdapter();
          const recipientId = getCurrentRecipientId();

          if (adapter && recipientId) {
            await processCommand(msg.cmd, msg.args, adapter, recipientId);
          }

          // Notify listeners
          for (const cb of pendingCallbacks) {
            cb(msg.cmd, msg.args, msg.chatId);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      connected = false;
      updateConnectedState(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      connected = false;
      updateConnectedState(false);
    };
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;

  console.log(`[devBridge] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function updateConnectedState(state: boolean) {
  if (window.__demoBridge) {
    window.__demoBridge.connected = state;
  }
}

async function processCommand(
  cmd: string,
  args: string[],
  adapter: DemoControls,
  recipientId: string,
): Promise<string> {
  switch (cmd) {
    case 'reset':
      adapter.reset?.();
      return 'Demo state has been reset.';

    case 'expire':
      (adapter as unknown as { expireSession?: () => void }).expireSession?.();
      return 'Session expired.';

    case 'fall':
      return await (adapter.emitCareEvent?.(recipientId) ?? Promise.resolve('emitCareEvent not available'));

    case 'hub_off':
      return await (adapter as unknown as { toggleHubConnection?: (id: string) => Promise<string> })
        .toggleHubConnection?.(recipientId) ?? Promise.resolve('toggleHubConnection not available');

    case 'hub_on':
      // First toggle off if currently on, then toggle on
      await (adapter as unknown as { toggleHubConnection?: (id: string) => Promise<string> })
        .toggleHubConnection?.(recipientId);
      return await (adapter as unknown as { toggleHubConnection?: (id: string) => Promise<string> })
        .toggleHubConnection?.(recipientId) ?? Promise.resolve('toggleHubConnection not available');

    case 'login_minh':
    case 'login_lan':
    case 'login_tuan': {
      // Extract persona from command
      const persona = cmd.replace('login_', '');
      return `Simulating login as ${persona}. Open the app and use the demo login.`;
    }

    case 'alert_ack':
      return 'Alert acknowledgment simulated. Open the app to see the update.';

    case 'safe_check': {
      const checklist = [
        '1. All data is simulated (source_mode=simulated)',
        '2. No real notifications are sent',
        '3. No images/videos from CareLens',
        '4. No real API or database',
      ].join('\n');
      return checklist;
    }

    case 'help': {
      const help = [
        'Available commands:',
        '/reset - Reset demo state',
        '/expire - Expire current session',
        '/fall - Emit care event (fall detection)',
        '/hub_off / hub_on - Toggle hub connection',
        '/login_minh / login_lan / login_tuan - Switch persona',
        '/safe_check - Print safety checklist',
      ].join('\n');
      return help;
    }

    default:
      return `Command /${cmd} not implemented in demo adapter.`;
  }
}

// Initialize connection when this script loads
if (import.meta.env.DEV) {
  connect();

  // Expose bridge API
  window.__demoBridge = {
    run: async (cmd: string, args: string[] = []): Promise<string> => {
      if (!connected) {
        return 'Bridge not connected.';
      }
      // Send command to bridge (for broadcasting to other tabs)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cmd', cmd, args }));
      }
      return `Sent /${cmd} to bridge.`;
    },
    onCmd: (fn: (cmd: string, args: string[], chatId: string) => void): void => {
      pendingCallbacks.push(fn);
    },
    connected: false,
  };

  console.log('[devBridge] Bridge script loaded. Connect to', WS_URL);
}
