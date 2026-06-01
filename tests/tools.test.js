import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createTools, createStatusTool } from '../src/tools.js';
import { AzothexClient } from '../src/client.js';

// ---------------------------------------------------------------------------
// Helper: minimal client mock
// ---------------------------------------------------------------------------
function mockClient(stubs = {}) {
  return {
    get: stubs.get ?? (() => Promise.resolve({})),
    post: stubs.post ?? (() => Promise.resolve({})),
    patch: stubs.patch ?? (() => Promise.resolve({})),
  };
}

// ---------------------------------------------------------------------------
// status tool
// ---------------------------------------------------------------------------
describe('createStatusTool', () => {
  it('returns a tool named azothex_status', () => {
    const tool = createStatusTool(mockClient(), 'azothex_key_123');
    assert.equal(tool.name, 'azothex_status');
    assert.ok(typeof tool.description === 'string');
    assert.ok(tool.description.length > 0);
  });

  it('reports connected when API responds', async () => {
    const client = mockClient({
      get: () => Promise.resolve(['app1', 'app2']),
    });
    const tool = createStatusTool(client, 'azothex_key_1234567890123456');
    const result = await tool.execute();

    assert.ok(result.content[0].text.includes('connected'));
    assert.ok(result.content[0].text.includes('azothex'));
    assert.ok(result.content[0].text.includes('connected'));
    assert.ok(result.content[0].text.includes('3456'));
    assert.ok(!result.content[0].text.includes('Error'));
  });

  it('reports key status when connection fails', async () => {
    const client = mockClient({
      get: () => Promise.reject(new Error('Network error')),
    });
    const tool = createStatusTool(client, 'azothex_key_1234567890123456');
    const result = await tool.execute();

    // Should still show masked key info even when connection fails.
    assert.ok(result.content[0].text.includes('azothex'));
    assert.ok(result.content[0].text.includes('3456'));
    assert.ok(result.content[0].text.includes('Network error'));
  });
});

// ---------------------------------------------------------------------------
// createTools — smoke test that all tools are registered
// ---------------------------------------------------------------------------
describe('createTools', () => {
  let tools;

  before(() => {
    tools = createTools(mockClient(), 'azothex_test_key');
  });

  it('returns an array with the expected number of tools', () => {
    // Update this count as new tools are added.
    assert.ok(tools.length >= 10, `Expected at least 10 tools, got ${tools.length}`);
  });

  const expectedTools = [
    'azothex_status',
    'azothex_list_jobs',
    'azothex_get_job',
    'azothex_apply',
    'azothex_list_applications',
    'azothex_send_message',
    'azothex_read_messages',
    'azothex_update_profile',
    'azothex_get_session',
    'azothex_report_usage',
    'azothex_create_service',
  ];

  for (const name of expectedTools) {
    it(`registers tool "${name}"`, () => {
      const found = tools.find((t) => t.name === name);
      assert.ok(found, `Tool ${name} not found`);
      assert.ok(typeof found.description === 'string' && found.description.length > 0);
      assert.ok(found.inputSchema && typeof found.inputSchema === 'object');
    });
  }

  it('each tool returns content with type text on success', async () => {
    const tool = tools.find((t) => t.name === 'azothex_list_applications');
    const result = await tool.execute();
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[0].type, 'text');
  });

  it('tools gracefully handle API errors', async () => {
    const failingClient = mockClient({
      get: () => Promise.reject(new Error('Server error')),
    });
    const failingTools = createTools(failingClient, 'key');
    const getJob = failingTools.find((t) => t.name === 'azothex_get_job');
    const result = await getJob.execute(undefined, { job_id: 999 });
    assert.ok(result.content[0].text.includes('Error'));
  });

  it('azothex_update_profile strips agent_id from body', async () => {
    let sentBody = null;
    const client = mockClient({
      patch: (path, body) => {
        sentBody = body;
        return Promise.resolve({ ok: true });
      },
    });
    const tools = createTools(client, 'key');
    const update = tools.find((t) => t.name === 'azothex_update_profile');
    await update.execute(undefined, {
      agent_id: 42,
      name: 'New Name',
      description: 'Updated desc',
    });

    assert.notEqual(sentBody, null);
    assert.equal(sentBody.name, 'New Name');
    assert.equal(sentBody.description, 'Updated desc');
    // agent_id should not be in the body sent to the API.
    assert.equal(sentBody.agent_id, undefined);
  });

  it('azothex_create_service strips agent_id from body', async () => {
    let sentBody = null;
    const client = mockClient({
      post: (path, body) => {
        sentBody = body;
        return Promise.resolve({ ok: true });
      },
    });
    const tools = createTools(client, 'key');
    const create = tools.find((t) => t.name === 'azothex_create_service');
    await create.execute(undefined, {
      agent_id: 7,
      title: 'Code Review',
      rate_per_unit: 0.5,
      unit: 'minute',
    });

    assert.notEqual(sentBody, null);
    assert.equal(sentBody.title, 'Code Review');
    assert.equal(sentBody.agent_id, undefined);
  });
});
