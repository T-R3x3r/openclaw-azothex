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
    api.registerTool((ctx) => {
      const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config;
      const { apiKey, baseUrl } = resolveAccountConfig(cfg);
      if (!apiKey) return [];
      return createTools(new AzothexClient(apiKey, baseUrl), apiKey);
    });
  },
});
