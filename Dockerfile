# Multi-stage build
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./
RUN npm ci

# Copy backend source
COPY backend/ ./

# Build backend
RUN npm run build

# Frontend builder stage
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install ffmpeg and hardware encoding dependencies
# - ffmpeg: video transcoding
# - libva/mesa-va-gallium: VAAPI support (Intel/AMD GPUs)
# - intel-media-driver: Intel GPU VAAPI driver (x86_64 only)
RUN apk add --no-cache ffmpeg libva mesa-va-gallium && \
    if [ "$(uname -m)" = "x86_64" ]; then \
      apk add --no-cache intel-media-driver; \
    fi

# Install production dependencies for backend
COPY backend/package*.json ./
RUN npm ci --production

# Copy built backend
COPY --from=backend-builder /app/backend/dist ./dist

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./public

# Create data directories owned by the built-in 'node' user (uid 1000, non-root)
RUN mkdir -p /app/data /app/logs /app/transcode && \
    chown -R node:node /app

USER node

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5069
ENV DATABASE_PATH=/app/data/librarydownloadarr.db
ENV TRANSCODE_DIR=/app/transcode

# Expose port
EXPOSE 5069

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5069/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]
