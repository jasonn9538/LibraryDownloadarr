import { Router } from 'express';
import { DatabaseService } from '../models/database';
import { transcodeManager } from '../services/transcodeManager';
import { plexService, RESOLUTION_PRESETS, getAvailableResolutions } from '../services/plexService';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware } from '../middleware/auth';

export const createTranscodesRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);

  // Helper function to get user credentials
  const getUserCredentials = (req: AuthRequest): { token: string | undefined; serverUrl: string; error?: string } => {
    const userToken = req.user?.plexToken;
    const isAdmin = req.user?.isAdmin;
    const adminToken = db.getSetting('plex_token') || undefined;
    const adminUrl = db.getSetting('plex_url') || '';

    if (!adminUrl) {
      return {
        token: undefined,
        serverUrl: '',
        error: 'Plex server not configured. Please contact administrator.'
      };
    }

    if (userToken) {
      return { token: userToken, serverUrl: adminUrl };
    }

    if (isAdmin && adminToken) {
      return { token: adminToken, serverUrl: adminUrl };
    }

    return {
      token: undefined,
      serverUrl: '',
      error: 'Access denied. Please log out and log in again.'
    };
  };

  // Get user's transcode jobs
  router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const jobs = transcodeManager.getUserJobs(req.user!.id);
      return res.json({ jobs });
    } catch (error) {
      logger.error('Failed to get transcode jobs', { error });
      return res.status(500).json({ error: 'Failed to get transcode jobs' });
    }
  });

  // Get all available transcodes (for "show all" toggle)
  router.get('/available', authMiddleware, async (_req: AuthRequest, res) => {
    try {
      const jobs = transcodeManager.getAllAvailableTranscodes();
      return res.json({ jobs });
    } catch (error) {
      logger.error('Failed to get available transcodes', { error });
      return res.status(500).json({ error: 'Failed to get available transcodes' });
    }
  });

  // Get job counts for badge
  router.get('/counts', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const counts = transcodeManager.getJobCounts(req.user!.id);
      return res.json(counts);
    } catch (error) {
      logger.error('Failed to get transcode counts', { error });
      return res.status(500).json({ error: 'Failed to get transcode counts' });
    }
  });

  // Get a specific job
  router.get('/:jobId', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const job = transcodeManager.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Only allow users to see their own jobs (unless admin)
      if (job.userId !== req.user!.id && !req.user?.isAdmin) {
        // Allow viewing if it's a completed job (shareable)
        if (job.status !== 'completed') {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      return res.json({ job });
    } catch (error) {
      logger.error('Failed to get transcode job', { error });
      return res.status(500).json({ error: 'Failed to get transcode job' });
    }
  });

  // Queue a new transcode job
  router.post('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { ratingKey, resolutionId } = req.body;

      if (!ratingKey || !resolutionId) {
        return res.status(400).json({ error: 'ratingKey and resolutionId are required' });
      }

      // Find the resolution preset
      const resolutionPreset = RESOLUTION_PRESETS.find(r => r.id === resolutionId);
      if (!resolutionPreset) {
        return res.status(400).json({ error: 'Invalid resolution preset' });
      }

      const { token, serverUrl, error } = getUserCredentials(req);

      if (error) {
        return res.status(403).json({ error });
      }

      if (!token || !serverUrl) {
        return res.status(401).json({ error: 'Plex token required' });
      }

      // Get media metadata
      plexService.setServerConnection(serverUrl, token);
      const metadata = await plexService.getMediaMetadata(ratingKey, token);

      const sourceMedia = metadata.Media?.[0];
      if (!sourceMedia) {
        return res.status(404).json({ error: 'No media found for this item' });
      }

      const sourceHeight = sourceMedia.height || 0;

      // Verify the requested resolution is <= source resolution
      if (resolutionPreset.height > sourceHeight) {
        return res.status(400).json({
          error: `Cannot transcode to ${resolutionPreset.label} - source is only ${sourceHeight}p`
        });
      }

      // Check download permission
      const isExplicitlyDisabled = metadata.allowSync === false ||
                                   metadata.allowSync === 0 ||
                                   metadata.allowSync === '0';

      if (isExplicitlyDisabled && !req.user?.isAdmin) {
        return res.status(403).json({
          error: 'Download not allowed. The server administrator has disabled downloads for your account.'
        });
      }

      // Generate filename
      const originalFilename = sourceMedia.Part?.[0]?.file.split('/').pop() || 'download';
      const baseName = originalFilename.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}_${resolutionPreset.id}.mp4`;

      // Determine media type
      let mediaType = metadata.type || 'video';

      // Format title
      let mediaTitle = metadata.title || 'Unknown';
      if (metadata.type === 'episode') {
        mediaTitle = `${metadata.grandparentTitle || 'Unknown Show'} - ${metadata.title}`;
      }

      // Queue the transcode
      const job = transcodeManager.queueTranscode(
        req.user!.id,
        ratingKey,
        resolutionId,
        resolutionPreset.label,
        resolutionPreset.height,
        resolutionPreset.maxVideoBitrate,
        mediaTitle,
        mediaType,
        filename
      );

      logger.info('Transcode queued via API', {
        jobId: job.id,
        userId: req.user!.id,
        title: mediaTitle,
        resolution: resolutionPreset.label,
      });

      return res.status(201).json({ job });
    } catch (error) {
      logger.error('Failed to queue transcode', { error });
      return res.status(500).json({ error: 'Failed to queue transcode' });
    }
  });

  // Cancel a transcode job
  router.delete('/:jobId', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const job = transcodeManager.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Only allow users to cancel their own jobs (unless admin)
      if (job.userId !== req.user!.id && !req.user?.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const success = transcodeManager.deleteJob(jobId);

      if (!success) {
        return res.status(500).json({ error: 'Failed to cancel/delete job' });
      }

      return res.json({ success: true });
    } catch (error) {
      logger.error('Failed to cancel transcode', { error });
      return res.status(500).json({ error: 'Failed to cancel transcode' });
    }
  });

  // Download a completed transcode
  router.get('/:jobId/download', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const job = transcodeManager.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.status !== 'completed') {
        return res.status(400).json({ error: 'Job is not completed yet' });
      }

      // Log the download
      db.logDownload(
        req.user!.id,
        `${job.mediaTitle} [${job.resolutionLabel}]`,
        job.ratingKey,
        job.fileSize
      );

      const success = transcodeManager.streamCompletedJob(jobId, res);

      if (!success) {
        return res.status(500).json({ error: 'Failed to stream file' });
      }

      return;
    } catch (error) {
      logger.error('Failed to download transcode', { error });
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to download transcode' });
      }
      return;
    }
  });

  return router;
};
