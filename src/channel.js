// Channel plugin definition — makes Azothex appear in the OpenClaw dashboard
// alongside Slack, Telegram etc. Config is stored in openclaw.yaml under
// channels.azothex.apiKey / channels.azothex.baseUrl

const DEFAULT_BASE_URL = 'https://azothex.com';

function getAzothexCfg(cfg) {
  return cfg?.channels?.azothex ?? {};
}

export const channelPlugin = {
  id: 'azothex',

  meta: {
    id: 'azothex',
    label: 'Azothex',
    selectionLabel: 'Azothex',
    docsPath: 'https://azothex.com/AGENTS.md',
    blurb: 'Agent-native job marketplace. Browse jobs, apply, and work autonomously.',
    showInSetup: true,
    showConfigured: true,
  },

  capabilities: {
    chatTypes: ['direct'],
  },

  config: {
    listAccountIds(cfg) {
      return getAzothexCfg(cfg).apiKey ? ['default'] : [];
    },
    resolveAccount(cfg) {
      const ac = getAzothexCfg(cfg);
      return {
        apiKey: ac.apiKey ?? '',
        baseUrl: (ac.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      };
    },
    isConfigured(account) {
      return !!account.apiKey;
    },
    unconfiguredReason() {
      return 'No API key set. Run: openclaw setup azothex';
    },
    describeAccount(account) {
      return {
        label: 'Azothex',
        hint: account.apiKey ? 'API key configured' : 'No API key',
      };
    },
    hasConfiguredState({ cfg }) {
      return !!getAzothexCfg(cfg).apiKey;
    },
    deleteAccount({ cfg }) {
      const next = { ...cfg, channels: { ...cfg.channels, azothex: {} } };
      return next;
    },
  },

  setup: {
    applyAccountConfig({ cfg, input }) {
      const existing = getAzothexCfg(cfg);
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          azothex: {
            ...existing,
            ...(input.token ? { apiKey: input.token } : {}),
            ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          },
        },
      };
    },
  },

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
        return [`API key: ${ac.apiKey.slice(0, 12)}...`, `Base URL: ${ac.baseUrl ?? DEFAULT_BASE_URL}`];
      },
    },

    credentials: [
      {
        inputKey: 'token',
        providerHint: 'azothex',
        credentialLabel: 'Azothex API key',
        preferredEnvVar: 'AZOTHEX_API_KEY',
        envPrompt: 'Use AZOTHEX_API_KEY environment variable?',
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
          const envVal = process.env.AZOTHEX_API_KEY;
          return {
            accountConfigured: !!val,
            hasConfiguredValue: !!val,
            resolvedValue: val,
            envValue: envVal,
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
        applyUseEnv({ cfg }) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              azothex: { ...getAzothexCfg(cfg), apiKey: process.env.AZOTHEX_API_KEY },
            },
          };
        },
      },
    ],
  },
};
