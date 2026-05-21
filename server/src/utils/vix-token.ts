// Vixcloud playback URLs (playlist + segment CDN + key storage) carry a
// `token=...&expires=...` query pair that vixcloud signs and TTLs to ~5min.
// We treat the presence of a non-expired pair as proof of access — required
// because AirPlay/Chromecast scenarios where a TV-side webapp fetches the
// stream directly can't carry the user's cookie.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

export function hasValidVixcloudSignature(uri: string): boolean {
  if (!uri) return false;

  const queryStart = uri.indexOf('?');
  if (queryStart < 0) return false;

  const params = new URLSearchParams(uri.slice(queryStart + 1));
  const token = params.get('token');
  const expires = params.get('expires');
  if (!token || !expires) return false;
  if (!TOKEN_PATTERN.test(token)) return false;

  const expiresAt = Number.parseInt(expires, 10);
  if (!Number.isFinite(expiresAt)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt > nowSec;
}
