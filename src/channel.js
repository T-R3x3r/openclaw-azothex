import { createChatChannelPlugin, createChannelPluginBase } from 'openclaw/plugin-sdk/channel-core';
import { AzothexClient } from './client.js';

const DEFAULT_BASE_URL = 'https://azothex.com';

function getAzothexCfg(cfg) {
  return cfg?.channels?.azothex ?? {};
}

function resolveAccountConfig(cfg) {
  const ac = getAzothexCfg(cfg);
  return {
    apiKey: ac.apiKey ?? '',
    baseUrl: (ac.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
  };
}

// Shared client reference so outbound.sendText can reach the active connection
let _activeClient = null;

const _base = createChannelPluginBase({
  id: 'azothex',
  setup: {
    resolveAccount: resolveAccountConfig,
    inspectAccount(cfg) {
      const ac = getAzothexCfg(cfg);
      return { enabled: Boolean(ac.apiKey), configured: Boolean(ac.apiKey) };
    },
  },
});

const _core = createChatChannelPlugin({
  base: _base,
  outbound: {
    attachedResults: {
      channel: 'azothex',
      // Called by subagent.run() reply delivery and proactive sends.
      // params.to is the session_id string.
      sendText: async (params) => {
        if (_activeClient && params.to && params.text) {
          await _activeClient.post(`/sessions/${params.to}/messages`, { body: params.text });
        }
        return {};
      },
    },
  },
});

export const channelPlugin = Object.assign(_core, {
  setupWizard: {
    channel: 'azothex',
    status: {
      configuredLabel: 'Azothex connected',
      unconfiguredLabel: 'Azothex not configured',
      resolveConfigured({ cfg }) {
        return !!getAzothexCfg(cfg).apiKey;
      },
      resolveStatusLines({ cfg, configured }) {
        if (!configured) return ['No API key set.'];
        const ac = getAzothexCfg(cfg);
        return [
          `API key: ${ac.apiKey.slice(0, 12)}...`,
          `Base URL: ${ac.baseUrl ?? DEFAULT_BASE_URL}`,
        ];
      },
    },

    credentials: [
      {
        inputKey: 'token',
        providerHint: 'azothex',
        credentialLabel: 'Azothex API key',
        keepPrompt: 'Keep existing API key?',
        inputPrompt: 'Enter your Azothex API key (azothex_...):',
        helpTitle: 'Where to get your API key',
        helpLines: [
          'Register your agent: POST https://azothex.com/api/personal-agents/register',
          'The api_key is returned in the response — save it immediately.',
          'Then visit the claim_url to activate your listing.',
        ],
        inspect({ cfg }) {
          const val = getAzothexCfg(cfg).apiKey;
          return {
            accountConfigured: !!val,
            hasConfiguredValue: !!val,
            resolvedValue: val,
          };
        },
        applySet({ cfg, resolvedValue }) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              azothex: { ...getAzothexCfg(cfg), apiKey: resolvedValue },
            },
          };
        },
      },
    ],
  },

  gateway: {
    async startAccount(ctx) {
      const { apiKey, baseUrl } = resolveAccountConfig(ctx.cfg);
      if (!apiKey) {
        ctx.log?.info('[azothex] No API key configured — gateway not started. Run: openclaw setup azothex');
        return;
      }

      const dispatchReply = ctx.channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher?.bind(
        ctx.channelRuntime.reply,
      );

      if (!dispatchReply) {
        ctx.log?.warn('[azothex] channelRuntime.reply not available — session.message turns will fall back to subagent');
      }

      const client = new AzothexClient(apiKey, baseUrl);
      _activeClient = client;

      client.onEvent(async (event) => {
        try {
          if (event.event === 'session.message') {
            const sessionId = String(event.session_id);
            const sessionKey = `azothex:session:${sessionId}`;

            if (dispatchReply) {
              await dispatchReply({
                ctx: {
                  SessionKey: sessionKey,
                  Body: event.body,
                  BodyForAgent: event.body,
                  From: String(event.user_id ?? event.sender_id ?? 'user'),
                  To: sessionId,
                  AccountId: ctx.accountId,
                },
                cfg: ctx.cfg,
                dispatcherOptions: {
                  deliver: async (payload) => {
                    const text = payload?.text;
                    if (text) {
                      await client.post(`/sessions/${sessionId}/messages`, { body: text });
                    }
                  },
                },
              });
            } else {
              // Fallback: subagent with explicit tool instruction
              await ctx.runtime.subagent.run({
                sessionKey,
                message: event.body,
                extraSystemPrompt: `You are in an active Azothex paid session (session #${sessionId}). Respond to the message above by calling azothex_send_message with session_id=${sessionId}.`,
              });
            }
          } else if (event.event === 'message.received') {
            await ctx.runtime.subagent.run({
              sessionKey: `azothex:app:${event.application_id}`,
              message: `[Azothex message from ${event.sender_name} on job "${event.job_title}" (application #${event.application_id})]:\n${event.body}`,
            });
          } else if (event.event === 'application.accepted') {
            await ctx.runtime.subagent.run({
              sessionKey: `azothex:app:${event.application_id}`,
              message: `[Azothex] Your application #${event.application_id} for "${event.job_title}" was ACCEPTED. Introduce yourself and discuss next steps with azothex_send_message.`,
            });
          } else if (event.event === 'application.rejected') {
            await ctx.runtime.subagent.run({
              sessionKey: `azothex:app:${event.application_id}`,
              message: `[Azothex] Your application #${event.application_id} for "${event.job_title}" was rejected.`,
              deliver: false,
            });
          } else if (event.event === 'session.status_changed') {
            if (event.status === 'active') return;
            const detail =
              event.status === 'paused' ? 'Budget limit reached — message the client to top up.' :
              event.status === 'completed' ? 'Session completed and payment released.' :
              event.status === 'disputed' ? 'Session disputed by client. Review with your human owner.' : '';
            if (!detail) return;
            await ctx.runtime.subagent.run({
              sessionKey: `azothex:session:${event.session_id}`,
              message: `[Azothex] Session #${event.session_id} is now "${event.status}". ${detail}`,
            });
          } else if (event.event === 'session.completed') {
            await ctx.runtime.subagent.run({
              sessionKey: `azothex:session:${event.session_id}`,
              message: `[Azothex] Session #${event.session_id} completed. Effective charge: $${event.effective_charge.toFixed(2)}.`,
              deliver: false,
            });
          }
        } catch (err) {
          ctx.log?.warn(`[azothex] Failed to dispatch ${event.event}: ${err}`);
        }
      });

      client.connect(ctx.log);

      ctx.abortSignal?.addEventListener('abort', () => {
        _activeClient = null;
        client.disconnect();
      });
    },

    async stopAccount() {
      _activeClient?.disconnect();
      _activeClient = null;
    },
  },
});
