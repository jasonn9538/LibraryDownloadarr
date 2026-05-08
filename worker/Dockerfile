# Build stage — compiles TypeScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production deps stage — clean install of runtime deps only
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Production — Ubuntu-based for NVIDIA driver compatibility
FROM nvidia/cuda:12.3.1-runtime-ubuntu22.04

# Install Jellyfin ffmpeg (includes NVENC, VAAPI, QSV support)
RUN apt-get update && apt-get install -y \
    curl \
    libva-dev \
    vainfo \
    gnupg \
    && curl -fsSL https://repo.jellyfin.org/ubuntu/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/jellyfin.gpg \
    && echo "deb [arch=amd64] https://repo.jellyfin.org/ubuntu jammy main" > /etc/apt/sources.list.d/jellyfin.list \
    && apt-get update \
    && apt-get install -y jellyfin-ffmpeg6 \
    && ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
    && ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Node.js binary from the builder stage — avoids curl|bash remote execution
COPY --from=prod-deps /usr/local/bin/node /usr/local/bin/node

# Copy production dependencies and compiled application
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create a non-root user and temp directory for transcodes
RUN useradd -r -u 1001 -g root node \
    && mkdir -p /tmp/transcode \
    && chown -R node:root /app /tmp/transcode

USER node

ENV NODE_ENV=production
ENV TEMP_DIR=/tmp/transcode

CMD ["node", "dist/index.js"]
