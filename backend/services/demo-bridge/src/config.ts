import 'dotenv/config';

export const config = {
  bridgeMode: (process.env.BRIDGE_MODE ?? 'polling') as 'polling' | 'webhook',
  port: Number(process.env.PORT ?? 8080),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    allowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    webhookPublicUrl: process.env.TELEGRAM_WEBHOOK_PUBLIC_URL ?? '',
  },
  secrets: {
    enabled: process.env.SM_ENABLED === '1',
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? '',
  },
};

// Validate at startup, fail-fast if missing
const required = [
  ['TELEGRAM_BOT_TOKEN', config.telegram.token],
  ['TELEGRAM_ALLOWED_CHAT_ID', config.telegram.allowedChatId],
];
const missing = required.filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
