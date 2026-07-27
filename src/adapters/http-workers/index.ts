import type { UnifiedConfig } from '../../shared/config/env.js';
import { createEncryptor } from '../../shared/crypto/aes-gcm.js';
import type { SessionStore, TokenStore } from '../../shared/storage/interface.js';
import { KvSessionStore, KvTokenStore } from '../../shared/storage/kv.js';
import { MemorySessionStore, MemoryTokenStore } from '../../shared/storage/memory.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

interface TokenKvNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkerStorage {
  tokenStore: TokenStore;
  sessionStore: SessionStore;
  close(): void;
}

/** Initialize one isolate-scoped storage graph with the existing KV key format. */
export function initializeWorkerStorage(
  kv: TokenKvNamespace,
  config: UnifiedConfig,
): WorkerStorage {
  const memoryTokens = new MemoryTokenStore();
  const memorySessions = new MemorySessionStore();
  const encryptor = config.RS_TOKENS_ENC_KEY
    ? createEncryptor(config.RS_TOKENS_ENC_KEY)
    : undefined;

  if (!encryptor && config.NODE_ENV === 'production') {
    logger.warning('worker_storage', {
      message: 'RS_TOKENS_ENC_KEY is not set; KV token records are unencrypted',
    });
  }

  const tokenStore = new KvTokenStore(kv, {
    encrypt: encryptor?.encrypt,
    decrypt: encryptor?.decrypt,
    fallback: memoryTokens,
  });
  const sessionStore = new KvSessionStore(kv, {
    encrypt: encryptor?.encrypt,
    decrypt: encryptor?.decrypt,
    fallback: memorySessions,
  });

  return {
    tokenStore,
    sessionStore,
    close() {
      memoryTokens.stopCleanup();
      memorySessions.stopCleanup();
    },
  };
}
