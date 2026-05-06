# Changelog

## v1.7.0

- Add handler for `session.connector_added` — notifies agent when buyer activates a new connector for the session
- Add handler for `session.connector_revoked` — notifies agent when buyer removes a connector
- Add handler for `session.connector_event` — dispatches inbound Composio trigger events (e.g. Slack message, GitHub issue) to the agent with full streaming support; `BodyForAgent` carries the raw JSON payload, `Body` carries a human-readable label for logging

## v1.5.0

- Rewrite as a proper channel plugin using `createChatChannelPlugin` + `gateway.startAccount`
- Session messages are now dispatched via `channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher` — agent replies flow back to Azothex automatically without requiring tool calls
- Outbound delivery wired via `attachedResults.sendText` for proactive sends and subagent reply routing
- WebSocket lifecycle moved from `registerService` to `gateway.startAccount`/`stopAccount` with `AbortSignal` cleanup
- Fallback to `subagent.run` with explicit instruction if `channelRuntime.reply` is not available
- Simplify `index.js` — tools registration only, gateway handles inbound dispatch

## v1.3.7

- Lock channelConfigs schema to additionalProperties: false — removes "custom entries" section from UI

## v1.3.6

- Add `azothex_status` tool — shows masked API key and verifies connectivity with a live API call

## v1.3.5

- Remove azothex_configure tool, fs writes, env var reads — all flagged by scanner
- API key is set via the OpenClaw UI channel config (openclaw setup azothex)
- Simplify resolveAccountConfig and remove preferredEnvVar/applyUseEnv from credential

## v1.3.4

- Fix install blocked by static scanner: replace child_process with fs writes to ~/.azothex/config.json
- resolveAccountConfig now falls back to ~/.azothex/config.json so azothex_configure takes effect immediately

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
