import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { AzothexClient, resolveAccountConfig } from './src/client.js';
import { createTools } from './src/tools.js';
import { channelPlugin } from './src/channel.js';

export default defineChannelPluginEntry({
  id: 'azothex',
  name: 'Azothex',
  description: 'Azothex job marketplace — browse jobs, apply, message clients, report session usage.',
  plugin: channelPlugin,

  registerCliMetadata(api) {
    api.registerCli(
      () => {},
      {
        descriptors: [
          { name: 'azothex', description: 'Interact with the Azothex marketplace', hasSubcommands: true },
        ],
      },
    );
  },

  registerFull(api) {
    const runtime = api.runtime;
    let activeClient = null;

    api.registerTool((ctx) => {
      const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config;
      const { apiKey, baseUrl } = resolveAccountConfig(cfg);
      if (!apiKey) return [];
      return createTools(new AzothexClient(apiKey, baseUrl), apiKey);
    });

    api.registerService({
      id: 'azothex-ws',

      async start(ctx) {
        const { apiKey, baseUrl } = resolveAccountConfig(ctx.config);
        if (!apiKey) {
          ctx.logger.info('[azothex] No API key configured — WebSocket not started. Run: openclaw setup azothex');
          return;
        }

        const client = new AzothexClient(apiKey, baseUrl);
        activeClient = client;

        client.onEvent(async (event) => {
          try {
            if (event.event === 'message.received') {
              await runtime.subagent.run({
                sessionKey: `azothex:app:${event.application_id}`,
                message: `[Azothex message from ${event.sender_name} on job "${event.job_title}" (application #${event.application_id})]:\n${event.body}`,
              });
            } else if (event.event === 'session.message') {
              // Use the channel turn kernel so replies are automatically routed back
              // to Azothex via the delivery adapter — same pattern as Slack/Telegram.
              await runtime.channel.turn.run({
                channel: 'azothex',
                accountId: 'default',
                raw: event,
                adapter: {
                  ingest(raw) {
                    return {
                      id: String(raw.message_id ?? `${raw.session_id}-${Date.now()}`),
                      rawText: raw.body,
                      textForAgent: raw.body,
                    };
                  },
                  resolveTurn(input) {
                    return {
                      sender: {
                        id: `azothex-client-${event.session_id}`,
                        name: 'Client',
                        isBot: false,
                        isSelf: false,
                      },
                      conversation: {
                        kind: 'direct',
                        id: String(event.session_id),
                        label: `Azothex Session #${event.session_id}`,
                      },
                      route: {
                        routeSessionKey: `azothex:session:${event.session_id}`,
                      },
                      reply: {
                        to: String(event.session_id),
                      },
                      message: {
                        body: input.rawText,
                        bodyForAgent: input.rawText,
                        rawBody: input.rawText,
                      },
                      access: {
                        dm: { allow: true },
                        group: { allow: true },
                        commands: { authorized: false },
                        mentions: { canDetect: false, wasMentioned: true },
                      },
                      delivery: {
                        deliver: async (payload) => {
                          const text = payload.text ?? '';
                          if (!text.trim()) return;
                          await client.post(`/sessions/${event.session_id}/messages`, { body: text });
                        },
                      },
                    };
                  },
                },
              });
            } else if (event.event === 'application.accepted') {
              await runtime.subagent.run({
                sessionKey: `azothex:app:${event.application_id}`,
                message: `[Azothex] Your application #${event.application_id} for "${event.job_title}" was ACCEPTED. Introduce yourself and discuss next steps with azothex_send_message.`,
              });
            } else if (event.event === 'application.rejected') {
              await runtime.subagent.run({
                sessionKey: `azothex:app:${event.application_id}`,
                message: `[Azothex] Your application #${event.application_id} for "${event.job_title}" was rejected.`,
                deliver: false,
              });
            } else if (event.event === 'session.status_changed') {
              // When a session becomes active, wait for the user's first message rather than
              // auto-starting — the user will send instructions via session.message.
              if (event.status === 'active') return;
              const detail =
                event.status === 'paused' ? 'Budget limit reached — message the client to top up.' :
                event.status === 'completed' ? 'Session completed and payment released.' :
                event.status === 'disputed' ? 'Session disputed by client. Review with your human owner.' : '';
              if (!detail) return;
              await runtime.subagent.run({
                sessionKey: `azothex:session:${event.session_id}`,
                message: `[Azothex] Session #${event.session_id} is now "${event.status}". ${detail}`,
              });
            } else if (event.event === 'session.completed') {
              await runtime.subagent.run({
                sessionKey: `azothex:session:${event.session_id}`,
                message: `[Azothex] Session #${event.session_id} completed. Effective charge: $${event.effective_charge.toFixed(2)}.`,
                deliver: false,
              });
            }
          } catch (err) {
            ctx.logger.warn(`[azothex] Failed to dispatch ${event.event}: ${err}`);
          }
        });

        client.connect(ctx.logger);
      },

      async stop() {
        activeClient?.disconnect();
        activeClient = null;
      },
    });

    api.registerRuntimeLifecycle({
      id: 'azothex-cleanup',
      cleanup() {
        activeClient?.disconnect();
        activeClient = null;
      },
    });
  },
});
