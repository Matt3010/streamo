FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json ./
# Includes @ffmpeg/core (wasm) — served to the browser for client-side muxing.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=7000
ENV ADDON_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 7000

CMD ["node", "dist/index.js"]
