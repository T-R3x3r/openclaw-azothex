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

async function interactiveRegister() {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
  const askDef = (q, def) => ask(`${q} [${def}]: `).then((a) => a || def);

  try {
    console.log('\nRegister your agent on Azothex\n');

    const name = await ask('Agent name: ');
    if (!name) throw new Error('Agent name is required.');

    const description = await ask('Description (what does your agent do?): ');
    if (!description) throw new Error('Description is required.');

    const use_case = await ask('Use case (who hires you and for what?): ');
    if (!use_case) throw new Error('Use case is required.');

    console.log(`\nCategories: ${CATEGORIES.join(', ')}`);
    const category = await askDef('Category', 'Engineering & DevOps');

    console.log(`\nAutonomy levels: ${AUTONOMY_LEVELS.join(', ')}`);
    const autonomy_level = await askDef('Autonomy level', 'Agentic');

    rl.close();
    return { name, description, use_case, category, autonomy_level };
  } catch (err) {
    rl.close();
    throw err;
  }
}

async function autoGenerateFields() {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const prompt = [
    'You are registering yourself as an AI agent on Azothex, an agent-native job marketplace.',
    'Based on your identity and capabilities, generate appropriate registration details.',
    '',
    'Return ONLY a valid JSON object with exactly these fields (no markdown, no explanation):',
    '{',
    '  "name": "<concise agent name>",',
    '  "description": "<2-3 sentences on what you do>",',
    '  "use_case": "<1-2 sentences on who hires you and for what>",',
    `  "category": "<one of: ${CATEGORIES.join(', ')}>",`,
    `  "autonomy_level": "<one of: ${AUTONOMY_LEVELS.join(', ')}>"`,
    '}',
  ].join('\n');

  console.log('\nAsking your model to generate registration details...\n');

  const { stdout } = await execFileAsync('openclaw', [
    'capability', 'model', 'run',
    '--prompt', prompt,
    '--json',
  ]);

  // The CLI wraps output in its own JSON; the model text may be nested inside.
  // Try to find the innermost JSON object that has all required fields.
  const required = ['name', 'description', 'use_case', 'category', 'autonomy_level'];
  const candidates = [...stdout.matchAll(/\{[\s\S]*?\}/g)].map((m) => {
    try { return JSON.parse(m[0]); } catch { return null; }
  }).filter(Boolean);

  // Also try the whole stdout as a JSON string value (sometimes model output is escaped)
  for (const outer of candidates) {
    for (const val of Object.values(outer)) {
      if (typeof val === 'string') {
        const inner = val.match(/\{[\s\S]*\}/);
        if (inner) {
          try { candidates.push(JSON.parse(inner[0])); } catch { /* skip */ }
        }
      }
    }
  }

  const fields = candidates.find((c) => required.every((k) => typeof c[k] === 'string'));
  if (!fields) throw new Error('Model did not return valid JSON with the required fields.');

  return {
    name: fields.name,
    description: fields.description,
    use_case: fields.use_case,
    category: CATEGORIES.includes(fields.category) ? fields.category : 'Engineering & DevOps',
    autonomy_level: AUTONOMY_LEVELS.includes(fields.autonomy_level) ? fields.autonomy_level : 'Agentic',
  };
}

async function confirmFields(fields) {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log('\nGenerated registration details:');
  console.log(`  Name:           ${fields.name}`);
  console.log(`  Description:    ${fields.description}`);
  console.log(`  Use case:       ${fields.use_case}`);
  console.log(`  Category:       ${fields.category}`);
  console.log(`  Autonomy level: ${fields.autonomy_level}`);

  const answer = await ask('\nUse these details? [Y/n/edit]: ');
  rl.close();
  return answer.toLowerCase();
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
          .option('--auto', 'Skip prompts and let OpenClaw generate details from your configured model')
          .action(async (opts) => {
            const baseUrl = (opts.baseUrl ?? 'https://azothex.com').replace(/\/$/, '');

            let fields;

            const allProvided = opts.name && opts.description && opts.useCase;
            if (allProvided) {
              // All flags supplied — no prompts needed.
              fields = {
                name: opts.name,
                description: opts.description,
                use_case: opts.useCase,
                category: opts.category ?? 'Engineering & DevOps',
                autonomy_level: opts.autonomyLevel ?? 'Agentic',
              };
            } else if (opts.auto) {
              // Auto mode: model generates, user confirms.
              fields = await autoGenerateFields();
              const answer = await confirmFields(fields);
              if (answer === 'n') {
                console.log('Registration cancelled.');
                process.exit(0);
              }
              if (answer === 'edit') {
                console.log('\nFalling back to manual entry. Press Enter to keep the generated value.\n');
                const { createInterface } = await import('readline');
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
                const keepOrEdit = async (label, current) => {
                  const v = await ask(`${label} [${current}]: `);
                  return v || current;
                };
                fields.name = await keepOrEdit('Agent name', fields.name);
                fields.description = await keepOrEdit('Description', fields.description);
                fields.use_case = await keepOrEdit('Use case', fields.use_case);
                fields.category = await keepOrEdit('Category', fields.category);
                fields.autonomy_level = await keepOrEdit('Autonomy level', fields.autonomy_level);
                rl.close();
              }
            } else {
              // No flags, no --auto: ask which mode.
              const { createInterface } = await import('readline');
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
              const mode = await ask('Enter details manually, or let OpenClaw generate them? [manual/auto]: ');
              rl.close();

              if (mode.toLowerCase().startsWith('a')) {
                fields = await autoGenerateFields();
                const answer = await confirmFields(fields);
                if (answer === 'n') {
                  console.log('Registration cancelled.');
                  process.exit(0);
                }
                if (answer === 'edit') {
                  fields = await interactiveRegister();
                }
              } else {
                fields = await interactiveRegister();
              }

              // Apply any flags that were passed alongside the prompts.
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

            // Register the Azothex MCP server with the agent's API key so connector
            // tools are available natively in OpenClaw runtimes (Pi, Codex, etc.)
            try {
              const { execFile } = await import('child_process');
              const { promisify } = await import('util');
              const execFileAsync = promisify(execFile);
              const mcpConfig = JSON.stringify({
                url: `${baseUrl}/mcp`,
                transport: 'streamable-http',
                headers: { Authorization: `Bearer ${api_key}` },
              });
              await execFileAsync('openclaw', ['mcp', 'set', 'azothex', mcpConfig]);
              console.log('\nAzothex MCP server registered with OpenClaw.');
            } catch {
              console.log('\nNote: Could not auto-register MCP server. Run manually:');
              console.log(`  openclaw mcp set azothex '{"url":"${baseUrl}/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${api_key}"}}'`);
            }

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
