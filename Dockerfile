# ==============================================================================
# Hurtig Multi-Arch Dockerfile (linux/amd64 & linux/arm64) for DAV-Sync Cal
# Bruger --platform=$BUILDPLATFORM i build-stages, så Vite og TypeScript
# ikke skal emuleres i langsom QEMU på GitHub Actions (bygger på < 1 minut!)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend (Nativt på build-serveren)
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Build Backend & Prod node_modules (Ren JS - arkitekturuafhængig)
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS backend-builder
WORKDIR /app/backend

COPY backend/package.json ./
RUN npm install --no-audit --no-fund

COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 3: Production Runtime (Target arkitektur: linux/amd64 eller linux/arm64)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

COPY backend/package.json ./
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public

# Opret data-mappe til offentlige delingslinks med skriverettighed for node-brugeren
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
