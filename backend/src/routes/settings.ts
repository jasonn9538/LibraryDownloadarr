import { Router } from 'express';
import { DatabaseService } from '../models/database';
import { plexService } from '../services/plexService';
import { transcodeManager } from '../services/transcodeManager';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware, createAdminMiddleware } from '../middleware/auth';

export const createSettingsRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);
  const adminMiddleware = createAdminMiddleware();

  // Get settings (admin only)
  router.get('/', authMiddleware, adminMiddleware, (_req: AuthRequest, res) => {
    try {
      const plexUrl = db.getSetting('plex_url') || '';
      const plexToken = db.getSetting('plex_token') || '';
      const plexMachineId = db.getSetting('plex_machine_id') || '';
      const plexServerName = db.getSetting('plex_server_name') || '';
      const pathMappingsJson = db.getSetting('path_mappings') || '[]';

      let pathMappings: Array<{ plexPath: string; localPath: string }> = [];
      try {
        pathMappings = JSON.parse(pathMappingsJson);
      } catch {
        pathMappings = [];
      }

      return res.json({
        settings: {
          plexUrl,
          hasPlexToken: !!plexToken,
          plexMachineId,
          plexServerName,
          pathMappings,
          maxConcurrentTranscodes: transcodeManager.getMaxConcurrent(),
        },
      });
    } catch (error) {
      logger.error('Failed to get settings', { error });
      return res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // Update settings (admin only)
  router.put('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { plexUrl, plexToken, pathMappings, maxConcurrentTranscodes } = req.body;

      // Handle max concurrent transcodes
      if (maxConcurrentTranscodes !== undefined) {
        const val = parseInt(maxConcurrentTranscodes, 10);
        if (isNaN(val) || val < 1 || val > 10) {
          return res.status(400).json({ error: 'Max concurrent transcodes must be between 1 and 10' });
        }
        db.setSetting('max_concurrent_transcodes', String(val));
        transcodeManager.setMaxConcurrent(val);
        logger.info('Max concurrent transcodes updated', { value: val });
      }

      if (plexUrl) {
        db.setSetting('plex_url', plexUrl);
      }
      if (plexToken) {
        db.setSetting('plex_token', plexToken);
      }
      if (pathMappings !== undefined) {
        // Validate path mappings format
        if (Array.isArray(pathMappings)) {
          const validMappings = pathMappings.filter(
            (m: any) => m && typeof m.plexPath === 'string' && typeof m.localPath === 'string'
          );
          db.setSetting('path_mappings', JSON.stringify(validMappings));
          logger.info('Path mappings updated', { count: validMappings.length });
        }
      }

      // Update Plex service connection and auto-fetch server identity
      if (plexUrl || plexToken) {
        const url = plexUrl || db.getSetting('plex_url') || '';
        const token = plexToken || db.getSetting('plex_token') || '';

        if (url && token) {
          plexService.setServerConnection(url, token);

          // Auto-fetch machine ID and server name
          try {
            const serverInfo = await plexService.getServerIdentity(token);

            if (serverInfo?.machineIdentifier) {
              db.setSetting('plex_machine_id', serverInfo.machineIdentifier);
              db.setSetting('plex_server_name', serverInfo.friendlyName);

              logger.debug('Auto-fetched server identity', {
                machineId: serverInfo.machineIdentifier,
                serverName: serverInfo.friendlyName
              });
            }
          } catch (error) {
            logger.warn('Failed to auto-fetch server identity', { error });
            // Don't fail the settings save if identity fetch fails
          }
        }
      }

      logger.info('Settings updated by admin');

      return res.json({ message: 'Settings updated successfully' });
    } catch (error) {
      logger.error('Failed to update settings', { error });
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Test Plex connection (admin only)
  router.post('/test-connection', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { plexUrl, plexToken } = req.body;

      // If URL and token provided in request, test those; otherwise test saved settings
      if (plexUrl && plexToken) {
        const isConnected = await plexService.testConnectionWithCredentials(plexUrl, plexToken);
        return res.json({ connected: isConnected });
      } else {
        const isConnected = await plexService.testConnection();
        return res.json({ connected: isConnected });
      }
    } catch (error) {
      logger.error('Connection test failed', { error });
      return res.status(500).json({ error: 'Connection test failed', connected: false });
    }
  });

  return router;
};
