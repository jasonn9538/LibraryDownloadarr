import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { DatabaseService } from '../models/database';
import { logger } from '../utils/logger';
import { WorkerAuthRequest, createWorkerAuthMiddleware } from '../middleware/workerAuth';
import { transcodeManager } from '../services/transcodeManager';

export const createWorkerRouter = (db: DatabaseService) => {
  const router = Router();
  const workerAuth = createWorkerAuthMiddleware(db);

  // Configure multer for file uploads to transcode directory
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      const cacheDir = transcodeManager.getCacheDir();
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      cb(null, cacheDir);
    },
    filename: (_req, file, cb) => {
      // Use a unique name to avoid collisions
      const uniqueSuffix = `${Date.now()}-worker`;
      cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
  });
  const upload = multer({ storage });

  // POST /api/worker/register - Worker announces itself
  router.post('/register', workerAuth, (req: WorkerAuthRequest, res) => {
    try {
      const { id, name, capabilities } = req.body;

      if (!id || !name) {
        return res.status(400).json({ error: 'Worker id and name are required' });
      }

      const worker = db.createWorker({
        id,
        name,
        capabilities: capabilities ? JSON.stringify(capabilities) : undefined,
      });

      logger.info('Worker registered', { workerId: id, name, capabilities });
      db.logAuditEvent('worker_registered', undefined, undefined, req.ip, { workerId: id, name });

      return res.json({ worker });
    } catch (error) {
      logger.error('Failed to register worker', { error });
      return res.status(500).json({ error: 'Failed to register worker' });
    }
  });

  // GET /api/worker/claim - Atomically claim next pending job
  router.get('/claim', workerAuth, (req: WorkerAuthRequest, res) => {
    try {
      const workerId = req.workerId;
      if (!workerId) {
        return res.status(400).json({ error: 'X-Worker-Id header required' });
      }

      // Verify worker exists
      const worker = db.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ error: 'Worker not registered' });
      }

      // Atomically claim next pending job
      const job = db.claimTranscodeJobForWorker(workerId);
      if (!job) {
        return res.status(204).send();
      }

      // Build Plex download URL for the worker
      const serverUrl = db.getSetting('plex_url');
      const plexToken = db.getSetting('plex_token');

      if (!serverUrl || !plexToken) {
        // Unclaim the job since we can't provide download info
        db.resetStaleWorkerJob(job.id);
        return res.status(500).json({ error: 'Plex server not configured' });
      }

      logger.info('Job claimed by worker', {
        jobId: job.id,
        workerId,
        title: job.mediaTitle,
      });

      return res.json({
        job: {
          id: job.id,
          ratingKey: job.ratingKey,
          resolutionId: job.resolutionId,
          resolutionLabel: job.resolutionLabel,
          resolutionHeight: job.resolutionHeight,
          maxBitrate: job.maxBitrate,
          mediaTitle: job.mediaTitle,
          mediaType: job.mediaType,
          filename: job.filename,
        },
        plex: {
          serverUrl,
          token: plexToken,
        },
      });
    } catch (error) {
      logger.error('Failed to claim job', { error });
      return res.status(500).json({ error: 'Failed to claim job' });
    }
  });

  // PUT /api/worker/jobs/:jobId/progress - Report transcode progress
  router.put('/jobs/:jobId/progress', workerAuth, (req: WorkerAuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const { progress } = req.body;
      const workerId = req.workerId;

      const job = db.getTranscodeJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // If job was cancelled, tell worker to abort
      if (job.status === 'cancelled') {
        return res.status(410).json({ error: 'Job was cancelled' });
      }

      // Verify this worker owns the job
      if (job.workerId !== workerId) {
        return res.status(403).json({ error: 'Job not assigned to this worker' });
      }

      // Update progress
      if (typeof progress === 'number' && progress >= 0 && progress <= 100) {
        db.updateTranscodeJobProgress(jobId, progress);
      }

      // Update worker heartbeat
      if (workerId) {
        const worker = db.getWorker(workerId);
        if (worker) {
          db.updateWorkerHeartbeat(workerId, worker.activeJobs);
        }
      }

      return res.json({ status: 'ok' });
    } catch (error) {
      logger.error('Failed to update progress', { error });
      return res.status(500).json({ error: 'Failed to update progress' });
    }
  });

  // POST /api/worker/jobs/:jobId/complete - Upload completed transcode
  router.post('/jobs/:jobId/complete', workerAuth, upload.single('file'), (req: WorkerAuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const workerId = req.workerId;

      // UPDATE HEARTBEAT IMMEDIATELY to prevent stale detection during upload
      if (workerId) {
        const worker = db.getWorker(workerId);
        if (worker) {
          db.updateWorkerHeartbeat(workerId, worker.activeJobs);
        }
      }

      const job = db.getTranscodeJob(jobId);
      if (!job) {
        // Clean up uploaded file
        if (req.file) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.status === 'cancelled') {
        // Clean up uploaded file
        if (req.file) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        return res.status(410).json({ error: 'Job was cancelled' });
      }

      if (job.workerId !== workerId) {
        if (req.file) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        return res.status(403).json({ error: 'Job not assigned to this worker' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Rename file to match expected naming convention
      const cacheKey = transcodeManager.getCacheKey(job.ratingKey, job.resolutionId);
      const finalPath = path.join(transcodeManager.getCacheDir(), `${cacheKey}-${Date.now()}.mp4`);

      try {
        fs.renameSync(req.file.path, finalPath);
      } catch {
        // If rename fails (cross-device), copy and delete
        fs.copyFileSync(req.file.path, finalPath);
        fs.unlinkSync(req.file.path);
      }

      const fileSize = fs.statSync(finalPath).size;

      // Update job as completed
      transcodeManager.handleWorkerJobComplete(jobId, finalPath, fileSize);

      logger.info('Worker completed transcode', {
        jobId,
        workerId,
        fileSize,
        title: job.mediaTitle,
      });

      return res.json({ status: 'completed' });
    } catch (error) {
      logger.error('Failed to complete job', { error });
      // Clean up uploaded file on error
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      }
      return res.status(500).json({ error: 'Failed to complete job' });
    }
  });

  // POST /api/worker/jobs/:jobId/error - Report transcoding failure
  router.post('/jobs/:jobId/error', workerAuth, (req: WorkerAuthRequest, res) => {
    try {
      const { jobId } = req.params;
      const { error: errorMessage } = req.body;
      const workerId = req.workerId;

      const job = db.getTranscodeJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.workerId !== workerId) {
        return res.status(403).json({ error: 'Job not assigned to this worker' });
      }

      db.updateTranscodeJobStatus(jobId, 'error', {
        error: errorMessage || 'Worker reported error',
      });

      logger.error('Worker reported transcode error', {
        jobId,
        workerId,
        error: errorMessage,
        title: job.mediaTitle,
      });

      return res.json({ status: 'error recorded' });
    } catch (error) {
      logger.error('Failed to report error', { error });
      return res.status(500).json({ error: 'Failed to report error' });
    }
  });

  // POST /api/worker/heartbeat - Periodic heartbeat
  router.post('/heartbeat', workerAuth, (req: WorkerAuthRequest, res) => {
    try {
      const workerId = req.workerId;
      if (!workerId) {
        return res.status(400).json({ error: 'X-Worker-Id header required' });
      }

      const worker = db.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ error: 'Worker not registered' });
      }

      const { activeJobs } = req.body;
      db.updateWorkerHeartbeat(workerId, typeof activeJobs === 'number' ? activeJobs : 0);

      return res.json({ status: 'ok' });
    } catch (error) {
      logger.error('Failed to process heartbeat', { error });
      return res.status(500).json({ error: 'Failed to process heartbeat' });
    }
  });

  return router;
};
