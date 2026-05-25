# Custom Caddy image bundling the Cloudflare DNS plugin. Needed because the
# stock caddy:2-alpine image does not include the cloudflare module, and
# Let's Encrypt DNS-01 challenges go through the Cloudflare DNS API.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
