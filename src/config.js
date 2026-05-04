const DEFAULT_BASE_URL = 'https://azothex.com';

export function resolveConfig(pluginConfig) {
  const cfg = pluginConfig ?? {};
  const apiKey = typeof cfg['apiKey'] === 'string' ? cfg['apiKey'].trim() : '';
  const baseUrl = typeof cfg['baseUrl'] === 'string' && cfg['baseUrl'].trim()
    ? cfg['baseUrl'].trim().replace(/\/$/, '')
    : DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}
