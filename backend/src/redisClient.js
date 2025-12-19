import { redisEnabled } from './redisAvailability.js';
import { resolveRedisUrlFromEnv, getRedisTargetForLogs } from './bullmqConnection.js';

let client;
let isConnecting = false;
let disabledForProcess = false;
let disabledReason;

export async function getRedisClient() {
  if (!redisEnabled) {
    return null;
  }

  if (disabledForProcess) {
    return null;
  }

  if (client && client.isOpen) {
    return client;
  }

  if (!client) {
    const redisUrl = resolveRedisUrlFromEnv();
    if (!redisUrl) {
      throw new Error('[redisClient] Redis is enabled but no REDIS_URL or REDIS_HOST provided');
    }

    const { createClient } = await import('redis');

    client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10_000,
        reconnectStrategy: (retries) => {
          // Exponential backoff with cap
          const delay = Math.min(30_000, 200 * 2 ** Math.max(0, retries - 1));
          return delay;
        },
      },
    });

    client.on('error', (err) => {
      const code = err?.code;
      if (process.env.NODE_ENV === 'development' && (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN')) {
        if (!disabledForProcess) {
          disabledForProcess = true;
          disabledReason = String(code);
          console.warn('[redisClient] Redis disabled for this process (dev):', { code, target: getRedisTargetForLogs() });
        }
        try {
          client?.disconnect?.();
        } catch {
        }
        return;
      }

      console.error('[redisClient] Redis Client Error:', err);
    });

    client.on('reconnecting', () => {
      console.warn('[redisClient] Redis reconnecting...', { target: getRedisTargetForLogs() });
    });

    client.on('ready', () => {
      console.log('[redisClient] Redis ready');
    });
  }

  if (!client.isOpen && !isConnecting) {
    isConnecting = true;
    try {
      await client.connect();
      console.log('[redisClient] Connected to Redis', { target: getRedisTargetForLogs() });
    } catch (err) {
      const code = err?.code;
      if (process.env.NODE_ENV === 'development' && (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN')) {
        disabledForProcess = true;
        disabledReason = String(code);
        console.warn('[redisClient] Redis connect failed; disabled for this process (dev):', {
          code,
          target: getRedisTargetForLogs(),
        });
        try {
          client?.disconnect?.();
        } catch {
        }
        client = null;
        return null;
      }

      console.error('[redisClient] Failed to connect to Redis:', err);
      throw err;
    } finally {
      isConnecting = false;
    }
  }

  return client;
}
