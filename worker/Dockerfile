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

# Install Node.js and ffmpeg
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    libva-dev \
    vainfo \
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
