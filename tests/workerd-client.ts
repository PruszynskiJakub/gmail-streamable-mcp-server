import { strict as assert } from 'node:assert';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL(process.env.MCP_TEST_URL || 'http://127.0.0.1:8787/mcp');
const expectedTools = [
  'get_profile',
  'inbox_overview',
  'list_labels',
  'modify_thread',
  'search_threads',
  'get_thread',
  'get_message',
  'create_draft',
  'update_draft',
  'send_draft',
];

async function check(mode: 'modern' | 'legacy'): Promise<void> {
  const client = new Client(
    { name: `workerd-${mode}`, version: '1.0.0' },
    mode === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    assert.equal(client.getProtocolEra(), mode);
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      expectedTools,
    );
    const result = await client.callTool({ name: 'get_profile', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(
      String(result.content[0]?.type === 'text' && result.content[0].text),
      /Authentication required/,
    );
  } finally {
    await client.close();
  }
}

await check('modern');
await check('legacy');
console.log('workerd modern + legacy official-client checks passed');
