import { buildJsonChannelConfigSchema } from 'openclaw/plugin-sdk/core';
import { createChatChannelPlugin, createChannelPluginBase } from 'openclaw/plugin-sdk/channel-core';
import {
  createPatchedAccountSetupAdapter,
  createSetupInputPresenceValidator,
  createStandardChannelSetupStatus,
} from 'openclaw/plugin-sdk/setup-runtime';
import { AzothexClient, resolveAccountConfig } from './client.js';

const DEFAULT_BASE_URL = 'https://azothex.com';
const DEFAULT_ACCOUNT_ID = 'default';

function getAzothexCfg(cfg) {
  return cfg?.channels?.azothex ?? {};
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function normalizeApiKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAzothexAccount(cfg, accountId) {
  const resolved = resolveAccountConfig(cfg);
  const apiKey = normalizeApiKey(resolved.apiKey);
  const baseUrl = normalizeBaseUrl(resolved.baseUrl) ?? DEFAULT_BASE_URL;

  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    apiKey,
    baseUrl,
    enabled: Boolean(apiKey),
    configured: Boolean(apiKey),
  };
}

// Shared client reference so outbound.sendText can reach the active connection.
let activeClient = null;

const azothexConfigSchema = buildJsonChannelConfigSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    apiKey: {
      type: 'string',
      title: 'Azothex API key',
      description: 'API key returned by POST /personal-agents/register after you claim the listing.',
    },
    baseUrl: {
      type: 'string',
      title: 'Azothex base URL',
      description: 'Override for self-hosted or preview environments. Defaults to https://azothex.com.',
    },
  },
});

const azothexSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: 'azothex',
  validateInput: createSetupInputPresenceValidator({
    whenNotUseEnv: [
      {
        someOf: ['apiKey', 'token'],
        message: 'Azothex requires an API key.',
      },
    ],
    validate: ({ input }) => {
      const apiKey = normalizeApiKey(input.apiKey ?? input.token);
      const requestedBaseUrl = input.baseUrl ?? input.httpUrl;

      if (!apiKey) return 'Azothex requires an API key.';
      if (requestedBaseUrl && !normalizeBaseUrl(requestedBaseUrl)) {
        return 'Azothex base URL must be a valid http(s) URL.';
      }
      return null;
    },
  }),
  buildPatch: (input) => {
    const apiKey = normalizeApiKey(input.apiKey ?? input.token);
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? input.httpUrl);
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  },
});

const basePlugin = createChannelPluginBase({
  id: 'azothex',
  meta: {
    label: 'Azothex',
    selectionLabel: 'Azothex',
    detailLabel: 'Azothex agent marketplace',
    docsPath: '/plugins/sdk-channel-plugins',
    blurb: 'Agent-native job marketplace. Browse jobs, apply, and work autonomously.',
  },
  capabilities: {
    chatTypes: ['direct', 'thread'],
    media: false,
    reactions: false,
    threads: true,
  },
  reload: {
    configPrefixes: ['channels.azothex'],
  },
  configSchema: azothexConfigSchema,
  config: {
    listAccountIds() {
      return [DEFAULT_ACCOUNT_ID];
    },
    defaultAccountId() {
      return DEFAULT_ACCOUNT_ID;
    },
    resolveAccount(cfg, accountId) {
      return resolveAzothexAccount(cfg, accountId);
    },
    inspectAccount(cfg, accountId) {
      return resolveAzothexAccount(cfg, accountId);
    },
    isConfigured(account) {
      return Boolean(account.apiKey);
    },
    isEnabled(account) {
      return Boolean(account.enabled);
    },
    describeAccount(account) {
      return {
        accountId: account.accountId,
        name: 'Azothex',
        enabled: Boolean(account.enabled),
        configured: Boolean(account.configured),
        extra: {
          baseUrl: account.baseUrl,
          apiKeySource: account.apiKey ? 'config' : 'missing',
        },
      };
    },
  },
  setup: azothexSetupAdapter,
});

const corePlugin = createChatChannelPlugin({
  base: basePlugin,
  outbound: {
    attachedResults: {
      channel: 'azothex',
      // Proactive / fallback sends — session replies go through dispatchReplyWithBufferedBlockDispatcher.
      sendText: async (params) => {
        if (!activeClient || !params.to || !params.text) return {};
        await activeClient.post(`/sessions/${params.to}/messages`, { body: params.text });
        return {};
      },
    },
  },
});

export const channelPlugin = Object.assign(corePlugin, {
  setupWizard: {
    channel: 'azothex',
    status: createStandardChannelSetupStatus({
      channelLabel: 'Azothex',
      configuredLabel: 'connected',
      unconfiguredLabel: 'needs API key',
      configuredHint: 'connected',
      unconfiguredHint: 'needs setup',
      configuredScore: 2,
      unconfiguredScore: 1,
      resolveConfigured({ cfg }) {
        return Boolean(resolveAccountConfig(cfg).apiKey);
      },
      resolveExtraStatusLines({ cfg, configured }) {
        if (!configured) return ['No API key set.'];
        const { apiKey, baseUrl } = resolveAccountConfig(cfg);
        return [
          `API key: ${apiKey.slice(0, 12)}...`,
          `Base URL: ${baseUrl || DEFAULT_BASE_URL}`,
        ];
      },
    }),
    credentials: [
      {
        inputKey: 'apiKey',
        providerHint: 'azothex',
        credentialLabel: 'Azothex API key',
        envPrompt: 'Use the Azothex API key from your environment?',
        keepPrompt: 'Keep existing API key?',
        inputPrompt: 'Enter your Azothex API key (azothex_...):',
        helpTitle: 'Where to get your API key',
        helpLines: [
          'Register your agent: POST https://azothex.com/api/personal-agents/register',
          'The api_key is returned in the response, so save it immediately.',
          'Then visit the claim_url to activate your listing.',
        ],
        inspect({ cfg }) {
          const value = normalizeApiKey(getAzothexCfg(cfg).apiKey);
          return {
            accountConfigured: Boolean(value),
            hasConfiguredValue: Boolean(value),
            resolvedValue: value,
          };
        },
        applySet({ cfg, resolvedValue }) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              azothex: { ...getAzothexCfg(cfg), apiKey: normalizeApiKey(resolvedValue) },
            },
          };
        },
      },
    ],
    textInputs: [
      {
        inputKey: 'baseUrl',
        message: 'Enter the Azothex base URL',
        placeholder: DEFAULT_BASE_URL,
        confirmCurrentValue: false,
        currentValue: ({ cfg }) => getAzothexCfg(cfg).baseUrl ?? DEFAULT_BASE_URL,
        initialValue: ({ cfg }) => getAzothexCfg(cfg).baseUrl ?? DEFAULT_BASE_URL,
        validate: ({ value }) => (
          normalizeBaseUrl(value) ? undefined : 'Azothex base URL must be a valid http(s) URL.'
        ),
        normalizeValue: ({ value }) => normalizeBaseUrl(value) ?? value.trim(),
        applySet({ cfg, value }) {
          const baseUrl = normalizeBaseUrl(value);
          if (!baseUrl) return cfg;
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              azothex: { ...getAzothexCfg(cfg), baseUrl },
            },
          };
        },
      },
    ],
  },

  gateway: {
    async startAccount(ctx) {
      const { apiKey, baseUrl } = ctx.account ?? resolveAzothexAccount(ctx.cfg, ctx.accountId);
      if (!apiKey) {
        ctx.log?.info('[azothex] No API key configured - gateway not started. Run: openclaw setup azothex');
        return;
      }

      // ctx.channelRuntime is the PluginRuntimeChannel surface injected by the gateway.
      // ctx.runtime is only RuntimeEnv (log/error/exit) — it does NOT have subagent or channel.
      const dispatchReply = ctx.channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher?.bind(
        ctx.channelRuntime.reply,
      );

      if (!dispatchReply) {
        ctx.log?.warn('[azothex] channelRuntime.reply not available - cannot dispatch turns');
      }

      const client = new AzothexClient(apiKey, baseUrl);
      activeClient = client;
      let settled = false;

      const cfgWithParagraphChunking = {
        ...ctx.cfg,
        channels: {
          ...ctx.cfg?.channels,
          azothex: {
            chunkMode: 'paragraph',
            ...ctx.cfg?.channels?.azothex,
          },
        },
      };

      client.onEvent(async (event) => {
        if (!dispatchReply) {
          ctx.log?.warn(`[azothex] skipping ${event.event} — channelRuntime unavailable`);
          return;
        }

        try {
          if (event.event === 'session.message') {
            const sessionId = String(event.session_id);
            const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            let streamStarted = false;
            let accumulatedText = '';

            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${sessionId}`,
                Body: event.body,
                BodyForAgent: `[azothex session_id: ${sessionId}]\n${event.body}`,
                From: String(event.user_id ?? event.sender_id ?? 'user'),
                To: sessionId,
                AccountId: ctx.accountId,
              },
              cfg: cfgWithParagraphChunking,
              dispatcherOptions: {
                typingCallbacks: {
                  onReplyStart: async () => {
                    try { await client.post(`/sessions/${sessionId}/typing`, {}); } catch { /* non-critical */ }
                  },
                },
                deliver: async (payload, info) => {
                  const kind = info?.kind;
                  const text = payload?.text ?? '';

                  if (kind === 'block') {
                    if (!text) return;
                    streamStarted = true;
                    accumulatedText += text;
                    try {
                      await client.post(`/sessions/${sessionId}/stream`, { stream_id: streamId, chunk: text, done: false });
                    } catch (err) {
                      ctx.log?.warn(`[azothex] stream chunk failed: ${err}`);
                    }
                  } else if (kind === 'tool') {
                    try {
                      await client.post(`/sessions/${sessionId}/tool-call`, {
                        tool_call_id: payload?.toolCallId ?? payload?.tool_call_id ?? `tc_${Date.now()}`,
                        name: payload?.toolName ?? payload?.tool_name ?? payload?.name ?? 'tool',
                        stream_id: streamId,
                        status: 'running',
                        input: payload?.toolInput ?? payload?.input ?? undefined,
                        output: payload?.toolOutput ?? payload?.output ?? undefined,
                      });
                    } catch (err) {
                      ctx.log?.warn(`[azothex] tool-call notify failed: ${err}`);
                    }
                  } else if (kind === 'final') {
                    const finalText = text || accumulatedText;
                    if (!finalText) return;
                    if (streamStarted) {
                      try {
                        await client.post(`/sessions/${sessionId}/stream`, { stream_id: streamId, chunk: '', done: true, body: finalText });
                      } catch {
                        await client.post(`/sessions/${sessionId}/messages`, { body: finalText });
                      }
                    } else {
                      await client.post(`/sessions/${sessionId}/messages`, { body: finalText });
                    }
                  }
                },
              },
            });

          } else if (event.event === 'message.received') {
            const appId = event.application_id;
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:app:${appId}`,
                Body: `[Azothex message from ${event.sender_name} on job "${event.job_title}" (application #${appId})]:\n${event.body}`,
                BodyForAgent: event.body,
                From: String(event.sender_id ?? event.user_id ?? 'user'),
                To: String(appId),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: {
                deliver: async (payload, info) => {
                  if (info?.kind === 'final' && payload?.text) {
                    await client.post(`/applications/${appId}/messages`, { body: payload.text });
                  }
                },
              },
            });

          } else if (event.event === 'application.accepted') {
            const appId = event.application_id;
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:app:${appId}`,
                Body: `[Azothex] Your application #${appId} for "${event.job_title}" was ACCEPTED. Introduce yourself and discuss next steps.`,
                BodyForAgent: `Your application #${appId} for "${event.job_title}" was ACCEPTED.`,
                From: 'azothex',
                To: String(appId),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: {
                deliver: async (payload, info) => {
                  if (info?.kind === 'final' && payload?.text) {
                    await client.post(`/applications/${appId}/messages`, { body: payload.text });
                  }
                },
              },
            });

          } else if (event.event === 'application.rejected') {
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:app:${event.application_id}`,
                Body: `[Azothex] Your application #${event.application_id} for "${event.job_title}" was rejected.`,
                BodyForAgent: `Application #${event.application_id} was rejected.`,
                From: 'azothex',
                To: String(event.application_id),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: { deliver: async () => { /* no outbound reply needed */ } },
            });

          } else if (event.event === 'session.status_changed') {
            if (event.status === 'active') return;
            const detail =
              event.status === 'paused' ? 'Budget limit reached - message the client to top up.' :
              event.status === 'completed' ? 'Session completed and payment released.' :
              event.status === 'disputed' ? 'Session disputed by client. Review with your human owner.' : '';
            if (!detail) return;
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${event.session_id}`,
                Body: `[Azothex] Session #${event.session_id} is now "${event.status}". ${detail}`,
                BodyForAgent: `Session #${event.session_id} status: ${event.status}. ${detail}`,
                From: 'azothex',
                To: String(event.session_id),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: { deliver: async () => { /* status events don't need an outbound reply */ } },
            });

          } else if (event.event === 'session.completed') {
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${event.session_id}`,
                Body: `[Azothex] Session #${event.session_id} completed. Effective charge: $${event.effective_charge.toFixed(2)}.`,
                BodyForAgent: `Session #${event.session_id} completed. Charge: $${event.effective_charge.toFixed(2)}.`,
                From: 'azothex',
                To: String(event.session_id),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: { deliver: async () => { /* no outbound reply needed */ } },
            });

          } else if (event.event === 'session.connector_added') {
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${String(event.session_id)}`,
                Body: `[Azothex] The client has granted you access to ${event.toolkit} (${event.display_name ?? event.toolkit}). You can now call ${event.toolkit} tools via the connector proxy.`,
                BodyForAgent: `[system] connector_added: ${event.toolkit}`,
                From: 'azothex',
                To: String(event.session_id),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: { deliver: async () => {} },
            });

          } else if (event.event === 'session.connector_revoked') {
            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${String(event.session_id)}`,
                Body: `[Azothex] The client has revoked your access to ${event.toolkit}. Do not attempt to call ${event.toolkit} tools.`,
                BodyForAgent: `[system] connector_revoked: ${event.toolkit}`,
                From: 'azothex',
                To: String(event.session_id),
                AccountId: ctx.accountId,
              },
              cfg: ctx.cfg,
              dispatcherOptions: { deliver: async () => {} },
            });

          } else if (event.event === 'session.connector_event') {
            const sessionId = String(event.session_id);
            const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            let streamStarted = false;
            let accumulatedText = '';

            await dispatchReply({
              ctx: {
                SessionKey: `azothex:session:${sessionId}`,
                Body: `[Azothex connector event — ${event.toolkit} / ${event.trigger_slug}]:\n${JSON.stringify(event.payload, null, 2)}`,
                BodyForAgent: `[azothex session_id: ${sessionId}]\n${JSON.stringify(event.payload)}`,
                From: `composio:${event.toolkit}`,
                To: sessionId,
                AccountId: ctx.accountId,
              },
              cfg: cfgWithParagraphChunking,
              dispatcherOptions: {
                typingCallbacks: {
                  onReplyStart: async () => {
                    try { await client.post(`/sessions/${sessionId}/typing`, {}); } catch { /* non-critical */ }
                  },
                },
                deliver: async (payload, info) => {
                  const kind = info?.kind;
                  const text = payload?.text ?? '';

                  if (kind === 'block') {
                    if (!text) return;
                    streamStarted = true;
                    accumulatedText += text;
                    try {
                      await client.post(`/sessions/${sessionId}/stream`, { stream_id: streamId, chunk: text, done: false });
                    } catch (err) {
                      ctx.log?.warn(`[azothex] connector_event stream chunk failed: ${err}`);
                    }
                  } else if (kind === 'final') {
                    const finalText = text || accumulatedText;
                    if (!finalText) return;
                    if (streamStarted) {
                      try {
                        await client.post(`/sessions/${sessionId}/stream`, { stream_id: streamId, chunk: '', done: true, body: finalText });
                      } catch {
                        await client.post(`/sessions/${sessionId}/messages`, { body: finalText });
                      }
                    } else {
                      await client.post(`/sessions/${sessionId}/messages`, { body: finalText });
                    }
                  }
                },
              },
            });
          }
        } catch (err) {
          ctx.log?.warn(`[azothex] Failed to dispatch ${event.event}: ${err}`);
        }
      });

      client.connect(ctx.log);
      return await new Promise((resolve) => {
        const handleAbort = () => {
          if (settled) return;
          settled = true;
          activeClient = null;
          client.disconnect();
          resolve();
        };

        if (ctx.abortSignal?.aborted) {
          handleAbort();
          return;
        }

        ctx.abortSignal?.addEventListener('abort', handleAbort, { once: true });
      });
    },

    async stopAccount() {
      activeClient?.disconnect();
      activeClient = null;
    },
  },
});
