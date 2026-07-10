// Proxy runtime config. All env-overridable.
export const config = {
  port: Number(process.env.PROXY_PORT ?? 8788),
  // Comma-separated allowed origins for CORS (the vidaaos app origin).
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  // Optional SOCKS5 URL for WARP egress (e.g. socks5://127.0.0.1:40000).
  // When set and a resolve request carries warp=true, upstream fetches route
  // through it. Default: direct (WARP off).
  warpSocksUrl: process.env.WARP_SOCKS_URL ?? '',
  warpControlUrl: process.env.WARP_CONTROL_URL ?? 'http://127.0.0.1:40001/register',
  // Desktop Chrome UA — bare Mozilla/5.0 is a bot fingerprint.
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  upstreamTimeoutMs: 20_000,
  // vixcloud expects these on playlist/segment fetches.
  vixHeaders: {
    Referer: 'https://vixcloud.co/',
    Origin: 'https://vixcloud.co'
  } as Record<string, string>
};
