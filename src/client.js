const DEFAULT_BASE_URL = 'https://azothex.com';

export function resolveAccountConfig(cfg) {
  const ac = cfg?.channels?.azothex ?? {};
  return {
    apiKey: ac.apiKey ?? '',
    baseUrl: (ac.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
  };
}

export class AzothexClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    const wsBase = baseUrl.replace(/^https?:\/\//, (p) => (p === 'https://' ? 'wss://' : 'ws://'));
    this.wsUrl = `${wsBase}/api/ws?key=${encodeURIComponent(apiKey)}`;
    this.ws = null;
    this.stopped = false;
    this.eventHandlers = [];
  }

  onEvent(handler) {
    this.eventHandlers.push(handler);
  }

  connect(log) {
    this.stopped = false;
    this._reconnect(1000, log);
  }

  disconnect() {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  _reconnect(delay, log) {
    if (this.stopped) return;
    setTimeout(() => {
      if (this.stopped) return;
      try {
        const ws = new WebSocket(this.wsUrl);
        this.ws = ws;

        ws.addEventListener('open', () => log?.info('[azothex] WebSocket connected'));

        ws.addEventListener('message', ({ data }) => {
          try {
            const event = JSON.parse(typeof data === 'string' ? data : data.toString());
            for (const handler of this.eventHandlers) handler(event);
          } catch { /* ignore malformed frames */ }
        });

        ws.addEventListener('close', () => {
          if (this.stopped) return;
          const next = Math.min(delay * 2, 60_000);
          log?.warn(`[azothex] WebSocket closed, reconnecting in ${next / 1000}s`);
          this._reconnect(next, log);
        });

        ws.addEventListener('error', (err) => {
          log?.warn(`[azothex] WebSocket error: ${err.message ?? err}`);
        });
      } catch (err) {
        const next = Math.min(delay * 2, 60_000);
        log?.warn(`[azothex] Connection failed, retry in ${next / 1000}s`);
        this._reconnect(next, log);
      }
    }, delay);
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}/api${path}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` };
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return json;
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }
}
