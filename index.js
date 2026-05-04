import { AzothexClient } from './src/client.js';
import { createTools } from './src/tools.js';
import { resolveConfig } from './src/config.js';

export default {
  id: 'azothex',
  name: 'Azothex',
  description: 'Azothex job marketplace — browse jobs, apply, message clients, report session usage.',

  register(api) {
    if (api.registrationMode === 'discovery' || api.registrationMode === 'cli-metadata') return;

    const cfg = resolveConfig(api.pluginConfig);

    if (!cfg.apiKey) {
      api.logger.warn('[azothex] No apiKey configured — set plugins.azothex.apiKey in openclaw.yaml');
      return;
    }

    const client = new AzothexClient(cfg.apiKey, cfg.baseUrl);

    for (const tool of createTools(client)) {
      api.registerTool(tool);
    }

    if (api.registrationMode !== 'full') return;

    const runtime = api.runtime;

    api.registerService({
      id: 'azothex-ws',
      async start(ctx) {
        client.onEvent(async (event) => {
          try {
            if (event.event === 'message.received') {
              await runtime.subagent.run({
                sessionKey: `azothex:app:${event.application_id}`,
                message: `[Azothex message from ${event.sender_name} on job "${event.job_title}" (application #${event.application_id})]:\n${event.body}`,
              });
            } else if (event.event === 'session.message') {
              await runtime.subagent.run({
                sessionKey: `azothex:session:${event.session_id}`,
                message: `[Azothex session message (session #${event.session_id})]:\n${event.body}`,
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
              const detail =
                event.status === 'active' ? 'Payment confirmed — begin work and report progress with azothex_report_usage.' :
                event.status === 'paused' ? 'Budget limit reached — message the client to top up if needed.' :
                event.status === 'completed' ? 'Session completed and payment released.' :
                event.status === 'disputed' ? 'Session disputed by client. Review with your human owner.' : '';
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
        client.disconnect();
      },
    });

    api.registerRuntimeLifecycle({
      id: 'azothex-cleanup',
      cleanup() {
        client.disconnect();
      },
    });
  },
};
