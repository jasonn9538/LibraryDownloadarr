import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { DatabaseService } from './models/database';
import { logger } from './utils/logger';
import { createAuthRouter } from './routes/auth';
import { createLibrariesRouter } from './routes/libraries';
import { createMediaRouter } from './routes/media';
import { createSettingsRouter } from './routes/settings';
import { createLogsRouter } from './routes/logs';
import { createTranscodesRouter } from './routes/transcodes';
import { createUsersRouter } from './routes/users';
import { createWorkerRouter } from './routes/worker';
import { transcodeManager } from './services/transcodeManager';

// Initialize database
const db = new DatabaseService(config.database.path);

// Initialize transcode manager with database
transcodeManager.initialize(db);

// Cleanup expired sessions every hour
setInterval(() => {
  db.cleanupExpiredSessions();
}, 60 * 60 * 1000);

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind needs inline styles
      imgSrc: ["'self'", "data:", "blob:"], // Images from our proxy and data URIs
      connectSrc: ["'self'", "https://plex.tv", "https://app.plex.tv"], // API calls
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'self'"], // Needed for iframe-based downloads
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Needed for Plex image proxying
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

// CORS - only enable if origin is configured
if (config.cors.origin) {
  app.use(cors(config.cors));
} else {
  // In production without explicit CORS_ORIGIN, only same-origin requests allowed
  logger.info('CORS disabled - only same-origin requests allowed');
}

// Rate limiting - exempt worker routes from global rate limit
const limiter = rateLimit(config.rateLimit);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  return res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Worker routes WITHOUT rate limiting (must come before rate limiter)
app.use('/api/worker', createWorkerRouter(db));

// Apply rate limiter to all OTHER /api/ routes
app.use('/api/', limiter);

// Routes
app.use('/api/auth', createAuthRouter(db));
app.use('/api/libraries', createLibrariesRouter(db));
app.use('/api/media', createMediaRouter(db));
app.use('/api/settings', createSettingsRouter(db));
app.use('/api/logs', createLogsRouter(db));
app.use('/api/transcodes', createTranscodesRouter(db));
app.use('/api/users', createUsersRouter(db));

// Serve static files (frontend)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (_req, res) => {
  return res.sendFile(path.join(publicPath, 'index.html'));
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err });
  return res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(config.server.port, () => {
  logger.info(`LibraryDownloadarr server started on port ${config.server.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  transcodeManager.shutdown();
  server.close(() => {
    logger.info('HTTP server closed');
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  transcodeManager.shutdown();
  server.close(() => {
    logger.info('HTTP server closed');
    db.close();
    process.exit(0);
  });
});

export { app, db };
