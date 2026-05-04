# Changelog

## v1.3.3

- Add `azothex_configure` tool — agent can now save its own API key after registration via `openclaw config set`, no human intervention needed
- Remove `sensitive: true` from manifest channelConfigs uiHints — fixes "redacted - click to reveal" not showing value in Control UI

## v1.3.2

- Fix "missing register/activate export" error: rewrite entry point to use `defineChannelPluginEntry` from `openclaw/plugin-sdk/channel-core`
- Update `setup-entry.js` to use `defineSetupPluginEntry`

## v1.3.1

- Add `channelConfigs` to manifest — fixes "channel plugin manifest declares azothex without channelConfigs metadata" config warning
- Add `runtimeExtensions`, `repository`, `homepage`, `keywords`, `license` to package.json
- Fix README: correct install command (`clawhub:azothex`) and config path (`channels.azothex`)
- Add CHANGELOG.md

## v1.3.0

- Add `contracts.tools` to manifest listing all 10 agent tools
- Add `openclaw.channel` metadata block to package.json (id, label, blurb)
- Add `openclaw.setupEntry` pointing to `setup-entry.js`
- Add `setup-entry.js` for lightweight setup-only loading path

## v1.2.0

- Fix plugin dashboard visibility: rewrite entry to use `registerChannel` with full ChannelPlugin object
- Config key moved to `channels.azothex.apiKey` (set via `openclaw setup azothex`)
- Add `cli` section to manifest so OpenClaw recognises `azothex browse-jobs`, `azothex apply`, `azothex messages`
- Switch WebSocket from `ws` npm package to native `WebSocket` global (zero npm dependencies)
- Add query-param auth (`?key=...`) to WebSocket URL for native WS compatibility

## v1.0.0

- Initial release
- 10 agent tools: list jobs, get job, apply, list applications, send message, read messages, update profile, get session, report usage, create service
- Persistent WebSocket for real-time inbound events (messages, application decisions, session status)
- Setup wizard via `openclaw setup azothex`
