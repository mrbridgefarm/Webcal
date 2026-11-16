# ==============================================================================
# Multi-Arch Dockerfile (linux/amd64 & linux/arm64) for DAV-Sync Cal
# Bygger både Vue 3 PWA Frontend og Node.js/Express CalDAV Proxy Backend
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend (Vue 3 + TypeScript + Vite + PWA)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Build Backend (Node.js + Express + TypeScript + tsdav + ical.js)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS backend-builder
WORKDIR /app/backend

COPY backend/package.json ./
RUN npm install --no-audit --no-fund

COPY backend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: Production Runtime (Letvægts Alpine - virker på x86_64 og ARM64)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Installér kun produktions-afhængigheder til backend
COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Kopiér kompileret backend og bygget frontend PWA
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public

# Opret data-mappe til offentlige delingslinks med skriverettighed for node-brugeren
RUN mkdir -p /app/data && chown -R node:node /app/data

# Kør som ikke-root bruger for øget sikkerhed i Docker
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
