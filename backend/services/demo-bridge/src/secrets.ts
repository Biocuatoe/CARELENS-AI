import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from './config.js';

const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let client: SecretManagerServiceClient | null = null;
if (config.secrets.enabled) {
  client = new SecretManagerServiceClient();
}

export async function getSecret(name: string): Promise<string> {
  if (!config.secrets.enabled) {
    return process.env[name] ?? '';
  }

  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!client) throw new Error('Secret Manager not initialized');
  const [version] = await client.accessSecretVersion({
    name: `projects/${config.secrets.projectId}/secrets/${name}/versions/latest`,
  });
  const value = version.payload?.data?.toString() ?? '';
  cache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
