# VixSrc Proxy Worker

Cloudflare Worker that proxies requests to vixsrc.to, hiding your origin server IP.

## Deploy

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Deploy the Worker

```bash
cd cloudflare-worker
wrangler deploy
```

After deployment, you'll get a URL like:
```
https://vixsrc-proxy.<your-subdomain>.workers.dev
```

### 4. Configure your app

Add the Worker URL to your environment:

```bash
# In your .env or docker-compose.yml
VIXSRC_PROXY_URL=https://vixsrc-proxy.yourname.workers.dev
```

Or in docker-compose.yml:
```yaml
services:
  nginx:
    environment:
      - VIXSRC_PROXY_URL=https://vixsrc-proxy.yourname.workers.dev
```

### 5. Restart nginx

```bash
docker-compose restart nginx
```

## Custom Domain (Optional)

Instead of using `workers.dev`, you can use your own subdomain:

1. Go to Cloudflare Dashboard → Workers & Pages → your worker
2. Click "Settings" → "Triggers" → "Add Custom Domain"
3. Add something like `proxy.yourdomain.com`
4. Update `VIXSRC_PROXY_URL` accordingly

## Limits (Free Tier)

- 100,000 requests/day (resets daily at midnight UTC)
- 10ms CPU time per request
- No egress bandwidth limits

For your use case (~5 requests per streaming session), this supports ~20,000 sessions/day.

## Routes

| Request to Worker | Proxied to |
|-------------------|------------|
| `/vixsrc/*` | `https://vixsrc.to/*` |
| `/vixcloud/*` | `https://vixcloud.co/*` |
| `/cdn/<sub>/*` | `https://<sub>.vix-content.net/*` |
