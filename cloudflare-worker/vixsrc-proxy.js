/**
 * Cloudflare Worker: VixSrc Proxy
 *
 * Proxies requests to vixsrc.to, vixcloud.co, and vix-content.net CDN
 * so that the origin server IP is never exposed to these providers.
 *
 * Routes:
 *   /vixsrc/*  → https://vixsrc.to/*
 *   /vixcloud/* → https://vixcloud.co/*
 *   /cdn/<subdomain>/* → https://<subdomain>.vix-content.net/*
 */

const ALLOWED_ORIGINS = [
  'vixsrc.to',
  'vixcloud.co',
  'vix-content.net'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    let targetUrl;
    let targetHost;

    // Route: /vixsrc/* → vixsrc.to/*
    if (path.startsWith('/vixsrc/')) {
      const targetPath = path.replace('/vixsrc/', '/');
      targetHost = 'vixsrc.to';
      targetUrl = `https://${targetHost}${targetPath}${url.search}`;
    }
    // Route: /vixcloud/* → vixcloud.co/*
    else if (path.startsWith('/vixcloud/')) {
      const targetPath = path.replace('/vixcloud/', '/');
      targetHost = 'vixcloud.co';
      targetUrl = `https://${targetHost}${targetPath}${url.search}`;
    }
    // Route: /cdn/<subdomain>/* → <subdomain>.vix-content.net/*
    else if (path.startsWith('/cdn/')) {
      const match = path.match(/^\/cdn\/([a-z0-9-]+)\/(.*)$/);
      if (!match) {
        return new Response('Invalid CDN path', { status: 400 });
      }
      const subdomain = match[1];
      const cdnPath = match[2];
      targetHost = `${subdomain}.vix-content.net`;
      targetUrl = `https://${targetHost}/${cdnPath}${url.search}`;
    }
    else {
      return new Response('Not Found', { status: 404 });
    }

    // Build headers for upstream request
    const headers = new Headers();
    headers.set('Host', targetHost);
    headers.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0');
    headers.set('Accept', request.headers.get('Accept') || '*/*');
    headers.set('Accept-Language', request.headers.get('Accept-Language') || 'en-US,en;q=0.9');
    headers.set('Referer', 'https://vixsrc.to/');
    headers.set('Origin', 'https://vixsrc.to');

    // Forward range header for video streaming
    if (request.headers.has('Range')) {
      headers.set('Range', request.headers.get('Range'));
    }

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        redirect: 'follow',
      });

      // Clone response and modify headers for CORS
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Range');

      // Remove headers that might cause issues
      responseHeaders.delete('Content-Security-Policy');
      responseHeaders.delete('X-Frame-Options');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, { status: 502 });
    }
  },
};
