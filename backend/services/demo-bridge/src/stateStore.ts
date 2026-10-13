/**
 * Central state store for the demo bridge.
 * Manages `state.json` persistence and broadcasts SSE events to connected web clients.
 *
 * State shape:
 * {
 *   recipients: {
 *     [recipientId]: {
 *       carelens: { online: boolean; last_seen_ms: number },
 *       ecopatch: { online: boolean; last_seen_ms: number }
 *     }
 *   },
 *   seq: number,
 *   updated_at: string
 * }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type ProductName = 'carelens' | 'ecopatch';

export interface ProductState {
  online: boolean;
  last_seen_ms: number;
}

export interface RecipientState {
  carelens: ProductState;
  ecopatch: ProductState;
}

export interface StateStoreData {
  recipients: Record<string, RecipientState>;
  seq: number;
  updated_at: string;
}

// -------------------------------------------------------------------------------------------------
// StateStore class
// -------------------------------------------------------------------------------------------------

export class StateStore {
  private data: StateStoreData;
  private readonly statePath: string;
  private readonly clients = new Set<(data: string) => void>();

  constructor(statePath: string) {
    this.statePath = statePath;
    this.data = this.load();
  }

  // -----------------------------------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------------------------------

  /** Load state from disk. Creates a default state file if none exists. */
  load(): StateStoreData {
    if (existsSync(this.statePath)) {
      try {
        const raw = readFileSync(this.statePath, 'utf-8');
        const parsed = JSON.parse(raw) as StateStoreData;
        // Basic validation
        if (typeof parsed.seq !== 'number') throw new Error('Missing seq');
        return parsed;
      } catch (err) {
        console.error(`[StateStore] Failed to parse ${this.statePath}, using defaults:`, err);
      }
    }
    // Initialize default state for r_liveshowcase
    const defaults: StateStoreData = {
      recipients: {
        r_liveshowcase: {
          carelens: { online: false, last_seen_ms: 0 },
          ecopatch: { online: false, last_seen_ms: 0 },
        },
      },
      seq: 0,
      updated_at: new Date().toISOString(),
    };
    this.persist(defaults);
    return defaults;
  }

  /** Write state to disk atomically via a temp file. */
  save(): void {
    this.persist(this.data);
  }

  private persist(data: StateStoreData): void {
    try {
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      // atomic rename is not guaranteed cross-platform but good enough for demo
      writeFileSync(this.statePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StateStore] Failed to persist state:', err);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // State mutation
  // -----------------------------------------------------------------------------------------------

  /**
   * Update the online status for a specific recipient + product.
   * Returns the updated product state.
   */
  set_online(recipientId: string, product: ProductName, online: boolean): ProductState {
    if (!this.data.recipients[recipientId]) {
      this.data.recipients[recipientId] = {
        carelens: { online: false, last_seen_ms: 0 },
        ecopatch: { online: false, last_seen_ms: 0 },
      };
    }

    const now_ms = Date.now();
    const entry = this.data.recipients[recipientId]![product]!;
    entry.online = online;
    entry.last_seen_ms = now_ms;

    this.data.seq += 1;
    this.data.updated_at = new Date().toISOString();
    this.save();

    return { online, last_seen_ms: now_ms };
  }

  // -----------------------------------------------------------------------------------------------
  // SSE client management
  // -----------------------------------------------------------------------------------------------

  /** Register a client send function (called by sseServer). */
  addClient(send: (data: string) => void): () => void {
    this.clients.add(send);
    return () => {
      this.clients.delete(send);
    };
  }

  /** Broadcast the current state to all SSE clients. */
  broadcast(): void {
    const payload = this.buildPayload();
    for (const send of this.clients) {
      try {
        send(payload);
      } catch {
        // Client already disconnected; will be cleaned up by remove
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Serialisation
  // -----------------------------------------------------------------------------------------------

  /** Build the SSE data payload matching DemoStateFromBackend shape. */
  buildPayload(): string {
    const hubs: Record<string, unknown> = {};

    for (const [recipientId, state] of Object.entries(this.data.recipients)) {
      // CareLens hub
      hubs[`hub_${recipientId}_carelens`] = {
        id: `hub_${recipientId}_carelens`,
        recipient_id: recipientId,
        online: state.carelens.online,
        last_seen_ms: state.carelens.last_seen_ms,
        signal_quality: state.carelens.online ? 'good' : 'unknown',
        battery: null,
      };
      // EcoPatch core
      hubs[`core_${recipientId}_ecopatch`] = {
        id: `core_${recipientId}_ecopatch`,
        recipient_id: recipientId,
        online: state.ecopatch.online,
        last_seen_ms: state.ecopatch.last_seen_ms,
        signal_quality: state.ecopatch.online ? 'good' : 'unknown',
        battery: null,
      };
    }

    return JSON.stringify({
      schema_version: '1.0',
      hubs,
      events: [],
      alerts: [],
      alert_actions: [],
      seq: this.data.seq,
      updated_at: this.data.updated_at,
    });
  }

  /** Current state snapshot (deep copy). */
  snapshot(): StateStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }
}
