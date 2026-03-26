FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime

ARG APP_VERSION=1.0.0

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

LABEL org.opencontainers.image.title="llm-bitbucket-mcp"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.description="Local/internal MCP server for Bitbucket Cloud"

RUN chown -R node:node /app

USER node

EXPOSE 8783

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8783/health > /dev/null || exit 1

CMD ["node", "src/server.js"]
