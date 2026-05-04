import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { channelPlugin } from './src/channel.js';

export default defineSetupPluginEntry(channelPlugin);
