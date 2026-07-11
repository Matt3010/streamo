import assert from 'node:assert/strict';

const EXACT_HOSTS = new Set(['api.telegra.ph', 'vixcloud.co', 'animeunity.so']);

export function isAllowedProvUrl(url: URL, providerHost?: string): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) ||
    host.endsWith('.vixcloud.co') ||
    host.endsWith('.animeunity.so') ||
    host === providerHost;
}

if (process.argv[1]?.endsWith('prov-url.ts')) {
  const current = 'streamingcommunity.digital';
  assert(isAllowedProvUrl(new URL('https://streamingcommunity.digital/it/search'), current));
  assert(!isAllowedProvUrl(new URL('https://streamingcommunity.attacker.com/'), current));
  assert(!isAllowedProvUrl(new URL('http://streamingcommunity.digital/'), current));
  console.log('prov-url.ts demo: OK');
}
