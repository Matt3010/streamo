FROM node:20-alpine AS build
WORKDIR /build/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY shared /build/shared
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
# Templates in /etc/nginx/templates/*.template are processed by the entrypoint
# with envsubst — only ${VAR} placeholders are substituted; nginx-native $vars
# (like $host, $args, $uri) are left intact because they have no braces.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY scripts/ /usr/share/nginx/html/scripts/
COPY --from=build /build/frontend/dist/browser/ /usr/share/nginx/html/
RUN set -eux; \
    scripts_dir=/usr/share/nginx/html/scripts; \
    template=/etc/nginx/templates/default.conf.template; \
    xhr_hash="$(sha256sum "$scripts_dir/xhr-proxy-rewrite.js" | cut -c1-12)"; \
    xhr_asset="xhr-proxy-rewrite.${xhr_hash}.js"; \
    cp "$scripts_dir/xhr-proxy-rewrite.js" "$scripts_dir/$xhr_asset"; \
    debug_hash="$(sha256sum "$scripts_dir/playback-debug.js" | cut -c1-12)"; \
    debug_asset="playback-debug.${debug_hash}.js"; \
    cp "$scripts_dir/playback-debug.js" "$scripts_dir/$debug_asset"; \
    sed -i \
      -e "s|__XHR_PROXY_REWRITE_ASSET__|$xhr_asset|g" \
      -e "s|__PLAYBACK_DEBUG_ASSET__|$debug_asset|g" \
      "$template"

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
