import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken } from '../helpers/auth-helpers';

vi.mock('../../services/plexService', () => ({
  plexService: {
    getMediaMetadata: vi.fn().mockResolvedValue({
      ratingKey: '12345', title: 'Test Movie', duration: 7200000,
      Media: [{ Part: [{ key: '/library/parts/12345/file.mkv' }] }],
    }),
    setServerConnection: vi.fn(),
    getServerIdentity: vi.fn().mockResolvedValue(null),
  },
  RESOLUTION_PRESETS: [],
}));

vi.mock('../../services/transcodeManager', () => ({
  transcodeManager: {
    initialize: vi.fn(),
    getCacheDir: vi.fn().mockReturnValue('/tmp/test-cache'),
    getCacheKey: vi.fn(),
    handleWorkerJobComplete: vi.fn(),
  },
}));

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
});

describe('Worker authentication security', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await request(app).post('/api/worker/register').send({ id: 'w1', name: 'W' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong API key', async () => {
    db.setSetting('worker_api_key', 'correct-key');
    const res = await request(app)
      .post('/api/worker/register')
      .set('Authorization', 'Bearer wrong-key')
      .send({ id: 'w1', name: 'Worker 1' });
    expect(res.status).toBe(401);
  });

  it('rejects when no API key is configured', async () => {
    const res = await request(app)
      .post('/api/worker/register')
      .set('Authorization', 'Bearer some-key')
      .send({ id: 'w1', name: 'Worker 1' });
    expect(res.status).toBe(401);
  });

  it('rejects partial key matches', async () => {
    const key = 'a'.repeat(64);
    db.setSetting('worker_api_key', key);
    const res = await request(app)
      .post('/api/worker/register')
      .set('Authorization', `Bearer ${'a'.repeat(63)}b`)
      .send({ id: 'w1', name: 'Worker 1' });
    expect(res.status).toBe(401);
  });

  it('rejects empty Bearer token', async () => {
    db.setSetting('worker_api_key', 'valid-key');
    const res = await request(app)
      .post('/api/worker/register')
      .set('Authorization', 'Bearer ')
      .send({ id: 'w1', name: 'Worker 1' });
    expect(res.status).toBe(401);
  });
});

describe('Worker cross-job isolation', () => {
  const workerKey = 'test-worker-key-' + Date.now();

  beforeEach(() => {
    db.setSetting('worker_api_key', workerKey);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'test-plex-token');
  });

  it('worker cannot update progress on another worker\'s job', async () => {
    db.createWorker({ id: 'worker-1', name: 'W1' });
    db.createWorker({ id: 'worker-2', name: 'W2' });

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
    expect(claimed.status).toBe(200);

    // Worker 2 tries to update progress
    const res = await request(app)
      .put(`/api/worker/jobs/${claimed.body.job.id}/progress`)
      .set('Authorization', `Bearer ${workerKey}`)
      .set('X-Worker-Id', 'worker-2')
      .send({ progress: 50 });
    expect(res.status).toBe(403);
  });

  it('worker cannot report error on another worker\'s job', async () => {
    db.createWorker({ id: 'worker-1', name: 'W1' });
    db.createWorker({ id: 'worker-2', name: 'W2' });

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

    const claimed = await request(app)
      .get('/api/worker/claim')
      .set('Authorization', `Bearer ${workerKey}`)
      .set('X-Worker-Id', 'worker-1');

    const res = await request(app)
      .post(`/api/worker/jobs/${claimed.body.job.id}/error`)
      .set('Authorization', `Bearer ${workerKey}`)
      .set('X-Worker-Id', 'worker-2')
      .send({ error: 'fake error' });
    expect(res.status).toBe(403);
  });

  it('claim endpoint does not expose Plex token', async () => {
    db.createWorker({ id: 'worker-1', name: 'W1' });

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
    // Plex token should NOT be in the response
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-plex-token');
    expect(res.body.plex).toBeUndefined();
  });
});
