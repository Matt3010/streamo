FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js db.js ./

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_DIR=/data

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
