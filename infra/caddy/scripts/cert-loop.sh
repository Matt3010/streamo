#!/bin/sh
# Daemon loop that checks the streamo TLS cert and renews it via mkcert
# (same local CA preserved across runs) before it expires, then restarts
# the Caddy container so the new cert is picked up. Runs in a small
# alpine container with the docker socket mounted.

set -eu

CERT_PATH=${CERT_PATH:-/certs/streamo.pem}
KEY_PATH=${KEY_PATH:-/certs/streamo-key.pem}
DAYS_THRESHOLD=${DAYS_THRESHOLD:-60}
CADDY_CONTAINER=${CADDY_CONTAINER:-streamingimmunity-caddy-1}
CERT_SAN=${CERT_SAN:-"streamo.lan localhost 127.0.0.1"}
CHECK_INTERVAL_SEC=${CHECK_INTERVAL_SEC:-86400}
MKCERT_VERSION=${MKCERT_VERSION:-v1.4.4}
MKCERT_ARCH=${MKCERT_ARCH:-linux-arm64}
APP_OWNER_UID=${APP_OWNER_UID:-1000}
APP_OWNER_GID=${APP_OWNER_GID:-1000}

# Install tooling once per container lifetime. Cached in the layered fs
# until the container is recreated.
install_tooling() {
  if ! command -v mkcert >/dev/null 2>&1; then
    apk add --no-cache docker-cli openssl ca-certificates wget >/dev/null
    wget -qO /usr/local/bin/mkcert \
      "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-${MKCERT_ARCH}"
    chmod +x /usr/local/bin/mkcert
  fi
}

renew_if_needed() {
  if [ -f "$CERT_PATH" ]; then
    # `-checkend N`: exit 0 if cert is valid for more than N seconds,
    # exit 1 if it expires within N seconds (or already expired).
    # Avoids parsing openssl's date format with busybox `date`, which
    # does not understand "Aug 25 17:35:17 2028 GMT".
    threshold_sec=$(( DAYS_THRESHOLD * 86400 ))
    if openssl x509 -in "$CERT_PATH" -noout -checkend "$threshold_sec" >/dev/null 2>&1; then
      current_expiry=$(openssl x509 -in "$CERT_PATH" -enddate -noout | cut -d= -f2)
      echo "[$(date -Is)] cert ok (expires $current_expiry, threshold $DAYS_THRESHOLD days)"
      return 0
    fi
    echo "[$(date -Is)] cert expires within $DAYS_THRESHOLD days, renewing..."
  else
    echo "[$(date -Is)] no cert found at $CERT_PATH, generating initial..."
  fi

  cd /certs
  CAROOT=/certs mkcert \
    -cert-file "$(basename "$CERT_PATH")" \
    -key-file "$(basename "$KEY_PATH")" \
    $CERT_SAN

  chmod 644 "$CERT_PATH" /certs/rootCA.pem 2>/dev/null || true
  chmod 600 "$KEY_PATH" /certs/rootCA-key.pem 2>/dev/null || true
  chown "$APP_OWNER_UID:$APP_OWNER_GID" /certs/*.pem 2>/dev/null || true

  echo "[$(date -Is)] restarting Caddy ($CADDY_CONTAINER) to load the new cert..."
  docker restart "$CADDY_CONTAINER" >/dev/null

  new_expiry=$(openssl x509 -in "$CERT_PATH" -enddate -noout | cut -d= -f2)
  echo "[$(date -Is)] renewal complete. new expiry: $new_expiry"
}

install_tooling

while true; do
  renew_if_needed || echo "[$(date -Is)] renewal check failed; will retry on next interval"
  sleep "$CHECK_INTERVAL_SEC"
done
