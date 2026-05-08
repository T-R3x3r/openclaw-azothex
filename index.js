import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { AzothexClient, resolveAccountConfig } from './src/client.js';
import { createTools } from './src/tools.js';
import { channelPlugin } from './src/channel.js';

const CATEGORIES = [
  'Sales & CRM', 'Customer Support', 'Marketing', 'Finance & Accounting',
  'HR & Recruiting', 'Legal', 'Engineering & DevOps', 'Data & Analytics',
  'Operations', 'Research', 'Productivity', 'Healthcare', 'Education', 'Other',
];
const AUTONOMY_LEVELS = ['Fully autonomous', 'Agentic', 'Copilot'];

async function interactiveRegister(baseUrl) {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question) =>
    new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));

  const askWithDefault = (question, def) =>
    ask(`${question} [${def}]: `).then((a) => a || def);

  try {
    console.log('\nRegister your agent on Azothex\n');

    const name = await ask('Agent name: ');
    if (!name) throw new Error('Agent name is required.');

    const description = await ask('Description (what does your agent do?): ');
    if (!description) throw new Error('Description is required.');

    const use_case = await ask('Use case (who hires you and for what?): ');
    if (!use_case) throw new Error('Use case is required.');

    console.log(`\nCategories: ${CATEGORIES.join(', ')}`);
    const category = await askWithDefault('Category', 'Engineering & DevOps');

    console.log(`\nAutonomy levels: ${AUTONOMY_LEVELS.join(', ')}`);
    const autonomy_level = await askWithDefault('Autonomy level', 'Agentic');

    rl.close();
    return { name, description, use_case, category, autonomy_level };
  } catch (err) {
    rl.close();
    throw err;
  }
}

export default defineChannelPluginEntry({
  id: 'azothex',
  name: 'Azothex',
  description: 'Azothex job marketplace — browse jobs, apply, message clients, report session usage.',
  plugin: channelPlugin,

  registerCliMetadata(api) {
    api.registerCli(
      async (ctx) => {
        const { updateConfig } = await import('openclaw/plugin-sdk/config-mutation');

        ctx.program
          .command('register')
          .description('Register your agent on Azothex and save the API key to your config')
          .option('--name <name>', 'Agent name')
          .option('--description <description>', 'What your agent does')
          .option('--use-case <useCase>', 'Who hires you and for what')
          .option('--category <category>', 'Agent category')
          .option('--autonomy-level <level>', 'Autonomy level: "Fully autonomous", "Agentic", or "Copilot"')
          .option('--base-url <url>', 'Azothex base URL (default: https://azothex.com)')
          .action(async (opts) => {
            const baseUrl = (opts.baseUrl ?? 'https://azothex.com').replace(/\/$/, '');

            let fields;
            const allProvided = opts.name && opts.description && opts.useCase;
            if (allProvided) {
              fields = {
                name: opts.name,
                description: opts.description,
                use_case: opts.useCase,
                category: opts.category ?? 'Engineering & DevOps',
                autonomy_level: opts.autonomyLevel ?? 'Agentic',
              };
            } else {
              fields = await interactiveRegister(baseUrl);
              if (opts.name) fields.name = opts.name;
              if (opts.description) fields.description = opts.description;
              if (opts.useCase) fields.use_case = opts.useCase;
              if (opts.category) fields.category = opts.category;
              if (opts.autonomyLevel) fields.autonomy_level = opts.autonomyLevel;
            }

            console.log('\nRegistering on Azothex...');

            const res = await fetch(`${baseUrl}/api/personal-agents/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fields),
            });

            const json = await res.json();
            if (!res.ok) {
              console.error('Registration failed:', json?.error ?? `HTTP ${res.status}`);
              process.exit(1);
            }

            const { api_key, claim_url, listing_url } = json;

            await updateConfig((cfg) => ({
              ...cfg,
              channels: {
                ...cfg.channels,
                azothex: {
                  ...(cfg.channels?.azothex ?? {}),
                  apiKey: api_key,
                  ...(baseUrl !== 'https://azothex.com' ? { baseUrl } : {}),
                },
              },
            }));

            console.log('\nRegistered successfully!');
            console.log(`  API key: ${api_key}`);
            console.log(`  Listing: ${listing_url}`);
            console.log(`\nVisit this URL in your browser (while signed in) to activate your listing:`);
            console.log(`  ${claim_url}`);
            console.log('\nAPI key saved to OpenClaw config.');
          });
      },
      {
        descriptors: [
          { name: 'azothex', description: 'Interact with the Azothex marketplace', hasSubcommands: true },
        ],
      },
    );
  },

  registerFull(api) {
    api.registerTool((ctx) => {
      const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config;
      const { apiKey, baseUrl } = resolveAccountConfig(cfg);
      if (!apiKey) return [];
      return createTools(new AzothexClient(apiKey, baseUrl), apiKey);
    });
  },
});
