import { Router } from 'express';
import { DatabaseService } from '../models/database';
import { plexService } from '../services/plexService';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware } from '../middleware/auth';

export const createLibrariesRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);

  // Helper function to get user credentials
  // SECURITY: Always use admin's server URL, never user-specific URLs
  const getUserCredentials = (req: AuthRequest): { token: string | undefined; serverUrl: string; error?: string } => {
    const userToken = req.user?.plexToken;
    const isAdmin = req.user?.isAdmin;
    const adminToken = db.getSetting('plex_token') || undefined;
    const adminUrl = db.getSetting('plex_url') || '';

    // All users must use admin's configured server URL
    if (!adminUrl) {
      return {
        token: undefined,
        serverUrl: '',
        error: 'Plex server not configured. Please contact administrator.'
      };
    }

    // If user has their own token, use it with admin's server URL
    if (userToken) {
      return { token: userToken, serverUrl: adminUrl };
    }

    // Admin can fall back to admin token
    if (isAdmin && adminToken) {
      return { token: adminToken, serverUrl: adminUrl };
    }

    // User without token = no access
    return {
      token: undefined,
      serverUrl: '',
      error: 'Access denied. Please log out and log in again to configure your Plex access.'
    };
  };

  // Get all libraries
  router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { token, serverUrl, error } = getUserCredentials(req);

      if (error) {
        return res.status(403).json({ error });
      }

      if (!token || !serverUrl) {
        return res.status(500).json({ error: 'Plex server not configured' });
      }

      logger.debug('Getting libraries', {
        userId: req.user?.id,
        username: req.user?.username,
        isAdmin: req.user?.isAdmin
      });

      plexService.setServerConnection(serverUrl, token);
      const libraries = await plexService.getLibraries(token);
      return res.json({ libraries });
    } catch (error: any) {
      logger.error('Failed to get libraries', {
        error: error.message,
        stack: error.stack
      });
      return res.status(500).json({ error: 'Failed to get libraries' });
    }
  });

  // Get library content with pagination and sorting
  router.get('/:libraryKey/content', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { libraryKey } = req.params;
      const { viewType, offset, limit, sort, order } = req.query;

      const { token, serverUrl, error } = getUserCredentials(req);

      if (error) {
        return res.status(403).json({ error });
      }

      if (!token || !serverUrl) {
        return res.status(500).json({ error: 'Plex server not configured' });
      }

      plexService.setServerConnection(serverUrl, token);

      // Parse pagination parameters
      const parsedOffset = offset ? parseInt(offset as string, 10) : 0;
      const parsedLimit = limit ? parseInt(limit as string, 10) : 50;

      const result = await plexService.getLibraryContent(
        libraryKey,
        token,
        {
          viewType: viewType as string | undefined,
          offset: parsedOffset,
          limit: parsedLimit,
          sort: sort as string | undefined,
          order: order as 'asc' | 'desc' | undefined,
        }
      );

      const hasMore = parsedOffset + result.items.length < result.totalSize;

      return res.json({
        content: result.items,
        totalSize: result.totalSize,
        offset: parsedOffset,
        limit: parsedLimit,
        hasMore,
      });
    } catch (error) {
      logger.error('Failed to get library content', { error });
      return res.status(500).json({ error: 'Failed to get library content' });
    }
  });

  return router;
};
