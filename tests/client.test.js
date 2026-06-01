import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AzothexClient, resolveAccountConfig } from '../src/client.js';

// ---------------------------------------------------------------------------
// resolveAccountConfig
// ---------------------------------------------------------------------------
describe('resolveAccountConfig', () => {
  it('returns default baseUrl and empty apiKey when no config given', () => {
    const cfg = resolveAccountConfig({});
    assert.equal(cfg.apiKey, '');
    assert.equal(cfg.baseUrl, 'https://azothex.com');
  });

  it('returns the configured apiKey and baseUrl', () => {
    const cfg = resolveAccountConfig({
      channels: {
        azothex: {
          apiKey: 'azothex_test_key_12345',
          baseUrl: 'https://staging.azothex.com',
        },
      },
    });
    assert.equal(cfg.apiKey, 'azothex_test_key_12345');
    assert.equal(cfg.baseUrl, 'https://staging.azothex.com');
  });

  it('strips trailing slash from baseUrl', () => {
    const cfg = resolveAccountConfig({
      channels: {
        azothex: { baseUrl: 'https://azothex.com/' },
      },
    });
    assert.equal(cfg.baseUrl, 'https://azothex.com');
  });
});

// ---------------------------------------------------------------------------
// AzothexClient — HTTP request
// ---------------------------------------------------------------------------
describe('AzothexClient', () => {
  let client;

  before(() => {
    client = new AzothexClient('test-key', 'https://azothex.com');
  });

  it('constructs with apiKey and baseUrl', () => {
    assert.equal(client.apiKey, 'test-key');
    assert.equal(client.baseUrl, 'https://azothex.com');
  });

  it('builds correct WebSocket URL from https base', () => {
    assert.match(client.wsUrl, /^wss:\/\//);
    assert.ok(client.wsUrl.includes('test-key'));
  });

  it('builds correct WebSocket URL from http base', () => {
    const httpClient = new AzothexClient('k', 'http://localhost:3000');
    assert.match(httpClient.wsUrl, /^ws:\/\/localhost:3000/);
  });

  describe('request', () => {
    it('sends GET with correct headers and parses JSON response', async () => {
      const mockFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: 'ok' }),
        }),
      );
      // Have to be careful about how we inject the mock — the class uses the
      // global `fetch`. We override it just for this test.
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const result = await client.get('/test');
        assert.deepEqual(result, { data: 'ok' });

        const entry = mockFetch.mock.calls[0];
        assert.equal(entry.arguments[0], 'https://azothex.com/api/test');
        assert.equal(entry.arguments[1].method, 'GET');
        assert.equal(entry.arguments[1].headers['Authorization'], 'Bearer test-key');
        assert.equal(entry.arguments[1].headers['Content-Type'], 'application/json');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('sends POST with JSON body', async () => {
      const mockFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 42 }),
        }),
      );
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const result = await client.post('/create', { name: 'test' });
        assert.deepEqual(result, { id: 42 });

        const entry = mockFetch.mock.calls[0];
        assert.equal(entry.arguments[1].method, 'POST');
        assert.equal(entry.arguments[1].body, JSON.stringify({ name: 'test' }));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('throws on non-ok response with error message', async () => {
      const mockFetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Invalid API key' }),
        }),
      );
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        await client.get('/secret');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('Invalid API key'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('throws on non-ok response without JSON error', async () => {
      const mockFetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        }),
      );
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        await client.get('/fail');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('HTTP 500'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
