import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEncryptor } from '../src/shared/crypto/aes-gcm.js';
import { FileTokenStore } from '../src/shared/storage/file.js';
import type { RsRecord } from '../src/shared/storage/interface.js';
import { KvTokenStore } from '../src/shared/storage/kv.js';
import { MemorySessionStore, MemoryTokenStore } from '../src/shared/storage/memory.js';

class FakeKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const tempDirs: string[] = [];
const memoryStores: Array<MemoryTokenStore | MemorySessionStore> = [];

afterEach(() => {
  for (const store of memoryStores) store.stopCleanup();
  memoryStores.length = 0;
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true });
  tempDirs.length = 0;
});

function record(): RsRecord {
  return {
    rs_access_token: 'existing-rs-access',
    rs_refresh_token: 'existing-rs-refresh',
    provider: {
      access_token: 'existing-gmail-access',
      refresh_token: 'existing-gmail-refresh',
      expires_at: Date.now() + 3_600_000,
      scopes: ['gmail.readonly'],
    },
    created_at: Date.now() - 10_000,
  };
}

describe('token storage compatibility', () => {
  test('reads the pre-migration plaintext FileTokenStore v1 shape unchanged', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gmail-mcp-file-'));
    tempDirs.push(directory);
    const file = join(directory, 'tokens.json');
    const existing = record();
    writeFileSync(
      file,
      JSON.stringify({ version: 1, encrypted: false, records: [existing] }),
    );

    const store = new FileTokenStore(file);
    expect(await store.getByRsAccess(existing.rs_access_token)).toMatchObject(existing);
    store.flush();
    store.stopCleanup();

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number;
      records: RsRecord[];
    };
    expect(persisted.version).toBe(1);
    expect(persisted.records[0]).toMatchObject(existing);
  });

  test('round-trips the existing encrypted FileTokenStore format', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gmail-mcp-encrypted-'));
    tempDirs.push(directory);
    const file = join(directory, 'tokens.enc');
    const key = Buffer.alloc(32, 7).toString('base64url');

    const writer = new FileTokenStore(file, key);
    await writer.storeRsMapping(
      'encrypted-rs-access',
      {
        access_token: 'encrypted-gmail-access',
        refresh_token: 'encrypted-gmail-refresh',
        expires_at: Date.now() + 3_600_000,
        scopes: ['gmail.readonly'],
      },
      'encrypted-rs-refresh',
    );
    writer.flush();
    writer.stopCleanup();
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).toThrow();

    const reader = new FileTokenStore(file, key);
    expect(
      (await reader.getByRsAccess('encrypted-rs-access'))?.provider.access_token,
    ).toBe('encrypted-gmail-access');
    reader.stopCleanup();
  });

  test('reads old plaintext and encrypted KV keys without migration', async () => {
    const existing = record();
    const plainKv = new FakeKv();
    plainKv.values.set(
      `rs:access:${existing.rs_access_token}`,
      JSON.stringify(existing),
    );
    plainKv.values.set(
      `rs:refresh:${existing.rs_refresh_token}`,
      JSON.stringify(existing),
    );
    const plainFallback = new MemoryTokenStore();
    memoryStores.push(plainFallback);
    const plainStore = new KvTokenStore(plainKv, { fallback: plainFallback });
    expect(await plainStore.getByRsAccess(existing.rs_access_token)).toEqual(existing);

    const encryptedKv = new FakeKv();
    const key = Buffer.alloc(32, 9).toString('base64url');
    const encryptor = createEncryptor(key);
    encryptedKv.values.set(
      `rs:access:${existing.rs_access_token}`,
      await encryptor.encrypt(JSON.stringify(existing)),
    );
    const encryptedFallback = new MemoryTokenStore();
    memoryStores.push(encryptedFallback);
    const encryptedStore = new KvTokenStore(encryptedKv, {
      ...encryptor,
      fallback: encryptedFallback,
    });
    expect(
      (await encryptedStore.getByRsAccess(existing.rs_access_token))?.provider
        .refresh_token,
    ).toBe('existing-gmail-refresh');
  });

  test('continues writing the same dual KV key record shape', async () => {
    const kv = new FakeKv();
    const fallback = new MemoryTokenStore();
    memoryStores.push(fallback);
    const store = new KvTokenStore(kv, { fallback });
    await store.storeRsMapping(
      'new-rs-access',
      {
        access_token: 'new-gmail-access',
        refresh_token: 'new-gmail-refresh',
        expires_at: Date.now() + 3_600_000,
      },
      'new-rs-refresh',
    );

    const byAccess = JSON.parse(
      kv.values.get('rs:access:new-rs-access') as string,
    ) as RsRecord;
    const byRefresh = JSON.parse(
      kv.values.get('rs:refresh:new-rs-refresh') as string,
    ) as RsRecord;
    expect(byAccess).toEqual(byRefresh);
    expect(byAccess).toMatchObject({
      rs_access_token: 'new-rs-access',
      rs_refresh_token: 'new-rs-refresh',
      provider: {
        access_token: 'new-gmail-access',
        refresh_token: 'new-gmail-refresh',
      },
    });
  });

  test('preserves MemorySessionStore behavior as OAuth product state', async () => {
    const sessions = new MemorySessionStore();
    memoryStores.push(sessions);
    await sessions.ensure('oauth-session');
    expect(await sessions.get('oauth-session')).toMatchObject({
      created_at: expect.any(Number),
    });
    await sessions.put('oauth-session', {
      created_at: 123,
      rs_access_token: 'rs-access',
    });
    expect(await sessions.get('oauth-session')).toMatchObject({
      created_at: 123,
      rs_access_token: 'rs-access',
    });
    await sessions.delete('oauth-session');
    expect(await sessions.get('oauth-session')).toBeNull();
  });
});
