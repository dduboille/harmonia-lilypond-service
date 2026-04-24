FROM node:22-slim

ARG CACHEBUST=1

RUN apt-get update && apt-get install -y \
    lilypond \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

ENV PORT=3001 \
    NODE_ENV=production \
    COMPILE_TIMEOUT=15000 \
    RATE_LIMIT=60

EXPOSE 3001

USER node

CMD ["node", "src/server.js"]