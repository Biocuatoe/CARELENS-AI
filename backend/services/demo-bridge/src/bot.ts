import { Bot, Context } from 'grammy';
import { WsHub } from './wsHub.js';
import { config } from './config.js';
import type { StateStore } from './stateStore.js';

type CommandHandler = (ctx: Context, hub: WsHub, stateStore?: StateStore) => Promise<string>;

const WHITELIST = new Set([
  'start', 'who', 'login_minh', 'login_lan', 'login_tuan', 'logout', 'expire',
  'people', 'open', 'share', 'revoke', 'cross_tenant',
  'fall', 'fall_high', 'fall_no_ai', 'hub_off', 'hub_on', 'frame_leak', 'face_id',
  'vitals', 'vitals_late', 'vitals_gap', 'patch_replace', 'patch_idempotent', 'gsr_hydration',
  'alert_list', 'alert_ack', 'alert_start', 'alert_resolve', 'alert_claim_other', 'dup_event',
  'devices', 'pair_fail', 'note', 'report_30d', 'export', 'admin', 'audit',
  'reset', 'pause', 'undo', 'safe_check', 'help', 'stage_carelens', 'stage_ecopatch',
  // State-only commands (silent — no Telegram reply)
  'c_online', 'c_offline', 'e_online', 'e_offline',
]);

export function createBot(hub: WsHub, stateStore?: StateStore): Bot {
  const bot = new Bot(config.telegram.token);

  // Middleware: check chat ID
  bot.use(async (ctx, next) => {
    if (!ctx.chat) return;
    if (String(ctx.chat.id) !== config.telegram.allowedChatId) {
      // Silently ignore unknown senders — don't log payload
      return;
    }
    await next();
  });

  // Command dispatcher
  bot.on('message:text', async (ctx) => {
    const text = ctx.msg.text.trim();
    const parts = text.split(' ');
    const cmd = parts[0]!.replace(/^\//, '');
    const args = parts.slice(1);

    if (!WHITELIST.has(cmd)) {
      await ctx.reply(`Unknown command: /${cmd}. Type /help for available commands.`);
      return;
    }

    // --- Silent commands: update state and broadcast, no reply ---
    const SILENT = new Set(['c_online', 'c_offline', 'e_online', 'e_offline']);
    if (SILENT.has(cmd)) {
      if (!stateStore) return;
      const RECIPIENT = 'r_liveshowcase';
      if (cmd === 'c_online') {
        stateStore.set_online(RECIPIENT, 'carelens', true);
      } else if (cmd === 'c_offline') {
        stateStore.set_online(RECIPIENT, 'carelens', false);
      } else if (cmd === 'e_online') {
        stateStore.set_online(RECIPIENT, 'ecopatch', true);
      } else if (cmd === 'e_offline') {
        stateStore.set_online(RECIPIENT, 'ecopatch', false);
      }
      stateStore.broadcast();
      return; // silent — no reply
    }

    try {
      const result = await dispatch(cmd, args, ctx, hub);
      await ctx.reply(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      await ctx.reply(`Error: ${msg}`);
    }
  });

  return bot;
}

async function dispatch(cmd: string, args: string[], ctx: Context, hub: WsHub): Promise<string> {
  const chatId = String(ctx.chat?.id ?? '');
  const payload = JSON.stringify({ cmd, args, chatId });
  const recipients = await hub.broadcast(payload);

  if (recipients === 0) {
    return `No open tabs for this persona. Open the web app and log in first.`;
  }
  return `Sent /${cmd} to ${recipients} tab(s).`;
}

export async function startBot(bot: Bot): Promise<void> {
  if (config.bridgeMode === 'webhook') {
    const url = config.telegram.webhookPublicUrl;
    const secret = config.telegram.webhookSecret;
    await bot.api.setWebhook(`${url}/telegram/webhook`, { secret_token: secret });
    console.log(`Webhook set: ${url}/telegram/webhook`);
  } else {
    await bot.start();
    console.log('Bot started (long polling)');
  }
}
