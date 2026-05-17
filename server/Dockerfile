FROM node:22-slim AS build
WORKDIR /build/server
COPY server/package.json ./
RUN npm install --no-audit --no-fund
COPY shared /build/shared
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /build/server/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/server/src/server.js"]
