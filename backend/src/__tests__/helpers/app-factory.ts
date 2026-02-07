import express from 'express';
import { DatabaseService } from '../../models/database';
import { createAuthRouter } from '../../routes/auth';
import { createLibrariesRouter } from '../../routes/libraries';
import { createMediaRouter } from '../../routes/media';
import { createSettingsRouter } from '../../routes/settings';
import { createLogsRouter } from '../../routes/logs';
import { createTranscodesRouter } from '../../routes/transcodes';
import { createUsersRouter } from '../../routes/users';

/**
 * Create a fresh Express app + in-memory SQLite database for testing.
 * Mirrors index.ts middleware/route setup but skips helmet, CORS,
 * rate-limiting, static files, and app.listen().
 */
export function createTestApp() {
  const db = new DatabaseService(':memory:');
  const app = express();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/api/health', (_req, res) => {
    return res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/libraries', createLibrariesRouter(db));
  app.use('/api/media', createMediaRouter(db));
  app.use('/api/settings', createSettingsRouter(db));
  app.use('/api/logs', createLogsRouter(db));
  app.use('/api/transcodes', createTranscodesRouter(db));
  app.use('/api/users', createUsersRouter(db));

  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    return res.status(500).json({ error: 'Internal server error' });
  });

  return { app, db };
}
