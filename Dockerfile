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
RUN adblock_hash="$(sha256sum /usr/share/nginx/html/scripts/adblock.js | awk '{print substr($1,1,16)}')" \
  && embed_bridge_hash="$(sha256sum /usr/share/nginx/html/scripts/embed-bridge.js | awk '{print substr($1,1,16)}')" \
  && mobile_player_controls_hash="$(sha256sum /usr/share/nginx/html/scripts/mobile-player-controls.js | awk '{print substr($1,1,16)}')" \
  && hide_player_elements_hash="$(sha256sum /usr/share/nginx/html/scripts/hide-player-elements.js | awk '{print substr($1,1,16)}')" \
  && sed -i "s/__ADBLOCK_HASH__/${adblock_hash}/g" /etc/nginx/templates/default.conf.template \
  && sed -i "s/__EMBED_BRIDGE_HASH__/${embed_bridge_hash}/g" /etc/nginx/templates/default.conf.template \
  && sed -i "s/__MOBILE_PLAYER_CONTROLS_HASH__/${mobile_player_controls_hash}/g" /etc/nginx/templates/default.conf.template \
  && sed -i "s/__HIDE_PLAYER_ELEMENTS_HASH__/${hide_player_elements_hash}/g" /etc/nginx/templates/default.conf.template
COPY --from=build /build/frontend/dist/browser/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
