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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
