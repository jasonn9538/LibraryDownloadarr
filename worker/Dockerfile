# Build stage
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production — Ubuntu-based for NVIDIA driver compatibility
FROM nvidia/cuda:12.3.1-runtime-ubuntu22.04

# Install Jellyfin ffmpeg (includes NVENC, VAAPI, QSV support) and Node.js
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
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --production

# Copy built application
COPY --from=builder /app/dist ./dist

# Create temp directory for transcodes
RUN mkdir -p /tmp/transcode

ENV NODE_ENV=production
ENV TEMP_DIR=/tmp/transcode

CMD ["node", "dist/index.js"]
