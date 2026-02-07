import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken } from '../helpers/auth-helpers';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';

let app: Express;
let db: DatabaseService;
let workerKey: string;

beforeEach(async () => {
  const testApp = createTestApp();
  app = testApp.app;
  db = testApp.db;

  // Generate a worker API key
  workerKey = 'test-worker-api-key-' + Date.now();
  db.setSetting('worker_api_key', workerKey);

  // Set up Plex credentials for claim endpoint
  db.setSetting('plex_url', 'http://localhost:32400');
  db.setSetting('plex_token', 'test-plex-token');
});

describe('Worker API Routes', () => {
  describe('POST /api/worker/register', () => {
    it('registers a worker successfully', async () => {
      const res = await request(app)
        .post('/api/worker/register')
        .set('Authorization', `Bearer ${workerKey}`)
        .send({
          id: 'worker-1',
          name: 'test-worker',
          capabilities: { gpu: 'NVIDIA', encoders: ['h264_nvenc', 'libx264'] },
        });

      expect(res.status).toBe(200);
      expect(res.body.worker).toBeDefined();
      expect(res.body.worker.name).toBe('test-worker');
      expect(res.body.worker.status).toBe('online');
    });

    it('rejects without API key', async () => {
      const res = await request(app)
        .post('/api/worker/register')
        .send({ id: 'worker-1', name: 'test-worker' });

      expect(res.status).toBe(401);
    });

    it('rejects with invalid API key', async () => {
      const res = await request(app)
        .post('/api/worker/register')
        .set('Authorization', 'Bearer invalid-key')
        .send({ id: 'worker-1', name: 'test-worker' });

      expect(res.status).toBe(401);
    });

    it('requires id and name', async () => {
      const res = await request(app)
        .post('/api/worker/register')
        .set('Authorization', `Bearer ${workerKey}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('re-registers an existing worker (upsert)', async () => {
      // Register first time
      await request(app)
        .post('/api/worker/register')
        .set('Authorization', `Bearer ${workerKey}`)
        .send({ id: 'worker-1', name: 'test-worker' });

      // Register again with updated name
      const res = await request(app)
        .post('/api/worker/register')
        .set('Authorization', `Bearer ${workerKey}`)
        .send({ id: 'worker-1', name: 'updated-worker' });

      expect(res.status).toBe(200);
      expect(res.body.worker.name).toBe('updated-worker');
    });
  });

  describe('GET /api/worker/claim', () => {
    it('returns 204 when no pending jobs', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });

      const res = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      expect(res.status).toBe(204);
    });

    it('claims a pending job', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });

      // Create a pending transcode job
      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      const res = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      expect(res.status).toBe(200);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.mediaTitle).toBe('Test Movie');
      expect(res.body.plex).toBeDefined();
      expect(res.body.plex.serverUrl).toBe('http://localhost:32400');
    });

    it('requires X-Worker-Id header', async () => {
      const res = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`);

      expect(res.status).toBe(400);
    });

    it('requires registered worker', async () => {
      const res = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'nonexistent-worker');

      expect(res.status).toBe(404);
    });

    it('atomically claims - second claim returns 204', async () => {
      db.createWorker({ id: 'worker-1', name: 'worker-1' });
      db.createWorker({ id: 'worker-2', name: 'worker-2' });

      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      // First worker claims
      const res1 = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      expect(res1.status).toBe(200);

      // Second worker gets nothing
      const res2 = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-2');

      expect(res2.status).toBe(204);
    });
  });

  describe('PUT /api/worker/jobs/:jobId/progress', () => {
    it('updates job progress', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });
      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      // Claim the job
      const claimed = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      const jobId = claimed.body.job.id;

      // Report progress
      const res = await request(app)
        .put(`/api/worker/jobs/${jobId}/progress`)
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1')
        .send({ progress: 50 });

      expect(res.status).toBe(200);

      // Verify progress in DB
      const job = db.getTranscodeJob(jobId);
      expect(job?.progress).toBe(50);
    });

    it('returns 410 if job was cancelled', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });
      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      // Claim
      const claimed = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      const jobId = claimed.body.job.id;

      // Cancel the job
      db.updateTranscodeJobStatus(jobId, 'cancelled');

      // Try to report progress
      const res = await request(app)
        .put(`/api/worker/jobs/${jobId}/progress`)
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1')
        .send({ progress: 50 });

      expect(res.status).toBe(410);
    });

    it('rejects progress from wrong worker', async () => {
      db.createWorker({ id: 'worker-1', name: 'worker-1' });
      db.createWorker({ id: 'worker-2', name: 'worker-2' });

      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      // Worker 1 claims
      const claimed = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      // Worker 2 tries to report progress
      const res = await request(app)
        .put(`/api/worker/jobs/${claimed.body.job.id}/progress`)
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-2')
        .send({ progress: 50 });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/worker/jobs/:jobId/error', () => {
    it('records an error for a job', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });
      const admin = await createAdminAndToken(db);
      db.createTranscodeJob({
        userId: admin.user.id,
        ratingKey: '12345',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      // Claim
      const claimed = await request(app)
        .get('/api/worker/claim')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1');

      const jobId = claimed.body.job.id;

      // Report error
      const res = await request(app)
        .post(`/api/worker/jobs/${jobId}/error`)
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1')
        .send({ error: 'ffmpeg crashed' });

      expect(res.status).toBe(200);

      // Verify error in DB
      const job = db.getTranscodeJob(jobId);
      expect(job?.status).toBe('error');
      expect(job?.error).toBe('ffmpeg crashed');
    });
  });

  describe('POST /api/worker/heartbeat', () => {
    it('updates worker heartbeat', async () => {
      db.createWorker({ id: 'worker-1', name: 'test-worker' });

      const res = await request(app)
        .post('/api/worker/heartbeat')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'worker-1')
        .send({ activeJobs: 2 });

      expect(res.status).toBe(200);

      // Verify in DB
      const worker = db.getWorker('worker-1');
      expect(worker?.activeJobs).toBe(2);
      expect(worker?.status).toBe('online');
    });

    it('requires X-Worker-Id header', async () => {
      const res = await request(app)
        .post('/api/worker/heartbeat')
        .set('Authorization', `Bearer ${workerKey}`)
        .send({ activeJobs: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unregistered worker', async () => {
      const res = await request(app)
        .post('/api/worker/heartbeat')
        .set('Authorization', `Bearer ${workerKey}`)
        .set('X-Worker-Id', 'nonexistent')
        .send({ activeJobs: 0 });

      expect(res.status).toBe(404);
    });
  });

  describe('Settings worker management', () => {
    it('GET /api/settings/workers lists workers', async () => {
      const { token } = await createAdminAndToken(db);
      db.createWorker({ id: 'worker-1', name: 'test-worker' });

      const res = await request(app)
        .get('/api/settings/workers')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.workers).toHaveLength(1);
      expect(res.body.workers[0].name).toBe('test-worker');
      expect(res.body.hasWorkerKey).toBe(true);
    });

    it('DELETE /api/settings/workers/:id removes a worker', async () => {
      const { token } = await createAdminAndToken(db);
      db.createWorker({ id: 'worker-1', name: 'test-worker' });

      const res = await request(app)
        .delete('/api/settings/workers/worker-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Verify deleted
      expect(db.getWorker('worker-1')).toBeUndefined();
    });

    it('POST /api/settings/workers/generate-key generates a key', async () => {
      const { token } = await createAdminAndToken(db);

      const res = await request(app)
        .post('/api/settings/workers/generate-key')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.key).toBeDefined();
      expect(res.body.key.length).toBe(64); // 32 bytes hex = 64 chars

      // Verify saved in settings
      expect(db.getSetting('worker_api_key')).toBe(res.body.key);
    });
  });
});
