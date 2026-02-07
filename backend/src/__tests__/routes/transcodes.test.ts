import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';
import { MOCK_METADATA_MOVIE, MOCK_METADATA_EPISODE } from '../helpers/plex-fixtures';

// Mock plexService
vi.mock('../../services/plexService', () => ({
  plexService: {
    setServerConnection: vi.fn(),
    getLibraries: vi.fn(),
    getLibraryContent: vi.fn(),
    getServerIdentity: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn(),
    testConnectionWithCredentials: vi.fn(),
    generatePin: vi.fn(),
    checkPin: vi.fn(),
    getUserServers: vi.fn(),
    findBestServerConnection: vi.fn(),
    getMediaMetadata: vi.fn(),
    getSeasons: vi.fn(),
    getEpisodes: vi.fn(),
    getTracks: vi.fn(),
    search: vi.fn(),
    getRecentlyAdded: vi.fn(),
    getDownloadUrl: vi.fn(),
    getDirectDownloadUrl: vi.fn(),
    getThumbnailUrl: vi.fn(),
  },
  getAvailableResolutions: vi.fn().mockReturnValue([]),
  RESOLUTION_PRESETS: [
    { id: '1080p', label: '1080p', height: 1080, width: 1920, maxVideoBitrate: 8000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
    { id: '720p', label: '720p', height: 720, width: 1280, maxVideoBitrate: 4000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
    { id: '480p', label: '480p', height: 480, width: 854, maxVideoBitrate: 2000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
  ],
}));

// Mock transcodeManager
vi.mock('../../services/transcodeManager', () => {
  const getUserJobs = vi.fn().mockReturnValue([]);
  const getAllTranscodes = vi.fn().mockReturnValue([]);
  const getAllAvailableTranscodes = vi.fn().mockReturnValue([]);
  const getJobCounts = vi.fn().mockReturnValue({ pending: 0, transcoding: 0, completed: 0, error: 0 });
  const getJob = vi.fn();
  const queueTranscode = vi.fn();
  const deleteJob = vi.fn();
  const getProgress = vi.fn();
  const streamCompletedJob = vi.fn();
  const getMaxConcurrent = vi.fn().mockReturnValue(2);
  const setMaxConcurrent = vi.fn();
  const initialize = vi.fn();
  const shutdown = vi.fn();

  return {
    transcodeManager: {
      getUserJobs,
      getAllTranscodes,
      getAllAvailableTranscodes,
      getJobCounts,
      getJob,
      queueTranscode,
      deleteJob,
      getProgress,
      streamCompletedJob,
      getMaxConcurrent,
      setMaxConcurrent,
      initialize,
      shutdown,
    },
  };
});

import { plexService } from '../../services/plexService';
import { transcodeManager } from '../../services/transcodeManager';
const mockedPlex = vi.mocked(plexService);
const mockedTranscode = vi.mocked(transcodeManager);

let app: Express;
let db: DatabaseService;

function setupPlexSettings() {
  db.setSetting('plex_url', 'http://localhost:32400');
  db.setSetting('plex_token', 'admin-plex-token');
}

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
  mockedTranscode.getUserJobs.mockReturnValue([]);
  mockedTranscode.getAllTranscodes.mockReturnValue([]);
  mockedTranscode.getAllAvailableTranscodes.mockReturnValue([]);
  mockedTranscode.getJobCounts.mockReturnValue({ pending: 0, transcoding: 0, completed: 0, error: 0 });
  mockedTranscode.getMaxConcurrent.mockReturnValue(2);
});

describe('GET /api/transcodes', () => {
  it('returns user jobs', async () => {
    const { token } = await createAdminAndToken(db);
    const mockJobs = [
      { id: 'job1', userId: 'u1', status: 'completed', mediaTitle: 'Movie 1' },
    ];
    mockedTranscode.getUserJobs.mockReturnValue(mockJobs as any);

    const res = await request(app)
      .get('/api/transcodes')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/transcodes');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/transcodes/all', () => {
  it('returns all transcodes', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getAllTranscodes.mockReturnValue([
      { id: 'job1', status: 'completed' },
      { id: 'job2', status: 'pending' },
    ] as any);

    const res = await request(app)
      .get('/api/transcodes/all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(2);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/transcodes/all');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/transcodes/counts', () => {
  it('returns job counts by status', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getJobCounts.mockReturnValue({
      pending: 2, transcoding: 1, completed: 5, error: 0,
    });

    const res = await request(app)
      .get('/api/transcodes/counts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(2);
    expect(res.body.transcoding).toBe(1);
    expect(res.body.completed).toBe(5);
  });
});

describe('GET /api/transcodes/:jobId', () => {
  it('returns own job', async () => {
    const { user, token } = await createAdminAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: user.id, status: 'completed', mediaTitle: 'Movie',
    } as any);

    const res = await request(app)
      .get('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe('job1');
  });

  it('allows viewing completed jobs from other users (shareable)', async () => {
    const { token } = createPlexUserAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: 'other-user', status: 'completed', mediaTitle: 'Movie',
    } as any);

    const res = await request(app)
      .get('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 for non-completed job from another user', async () => {
    const { token } = createPlexUserAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: 'other-user', status: 'transcoding', mediaTitle: 'Movie',
    } as any);

    const res = await request(app)
      .get('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent job', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getJob.mockReturnValue(undefined);

    const res = await request(app)
      .get('/api/transcodes/nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/transcodes', () => {
  it('queues a transcode job', async () => {
    const { user, token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue(MOCK_METADATA_MOVIE as any);
    mockedTranscode.queueTranscode.mockReturnValue({
      id: 'newjob', userId: user.id, status: 'pending', mediaTitle: 'Test Movie',
    } as any);

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: '720p' });
    expect(res.status).toBe(201);
    expect(res.body.job.id).toBe('newjob');
  });

  it('returns 400 when missing required fields', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  it('returns 400 for invalid resolution', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: 'invalid-res' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid resolution');
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: '720p' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when download disabled for user', async () => {
    const { token } = createPlexUserAndToken(db, { plexToken: 'user-tok' });
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue({
      ...MOCK_METADATA_MOVIE,
      allowSync: false,
    } as any);

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: '720p' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not allowed');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/transcodes')
      .send({ ratingKey: '100', resolutionId: '720p' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/transcodes/batch', () => {
  it('admin queues multiple transcodes', async () => {
    const { user, token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue(MOCK_METADATA_MOVIE as any);
    let jobCounter = 0;
    mockedTranscode.queueTranscode.mockImplementation(() => {
      jobCounter++;
      return { id: `job${jobCounter}`, userId: user.id, status: 'pending' } as any;
    });

    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: ['100', '101'], resolutionId: '720p' });
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(2);
    expect(res.body.totalCount).toBe(2);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: ['100'], resolutionId: '720p' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty array', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: [], resolutionId: '720p' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for more than 100 items', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const keys = Array.from({ length: 101 }, (_, i) => String(i));
    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: keys, resolutionId: '720p' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('100');
  });

  it('returns 400 for missing resolutionId', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: ['100'] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid resolution', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .post('/api/transcodes/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKeys: ['100'], resolutionId: 'bad-res' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid resolution');
  });
});

describe('DELETE /api/transcodes/:jobId', () => {
  it('cancels own job', async () => {
    const { user, token } = await createAdminAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: user.id, status: 'pending',
    } as any);
    mockedTranscode.deleteJob.mockReturnValue(true);

    const res = await request(app)
      .delete('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when non-admin tries to delete another user job', async () => {
    const { token } = createPlexUserAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: 'other-user-id', status: 'pending',
    } as any);

    const res = await request(app)
      .delete('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('admin can delete any job', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getJob.mockReturnValue({
      id: 'job1', userId: 'other-user', status: 'completed',
    } as any);
    mockedTranscode.deleteJob.mockReturnValue(true);

    const res = await request(app)
      .delete('/api/transcodes/job1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent job', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getJob.mockReturnValue(undefined);

    const res = await request(app)
      .delete('/api/transcodes/nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/transcodes/available', () => {
  it('returns all available completed transcodes', async () => {
    const { token } = await createAdminAndToken(db);
    mockedTranscode.getAllAvailableTranscodes.mockReturnValue([
      { id: 'job1', status: 'completed', mediaTitle: 'Movie 1' },
    ] as any);

    const res = await request(app)
      .get('/api/transcodes/available')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/transcodes/available');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/transcodes/media/:ratingKey', () => {
  it('returns transcodes for a specific media item', async () => {
    const { token } = await createAdminAndToken(db);
    // This endpoint reads directly from DB, not transcodeManager mock
    // So we need to create a transcode job in the DB
    db.createTranscodeJob({
      userId: 'test-user',
      ratingKey: '100',
      resolutionId: '720p',
      resolutionLabel: '720p',
      resolutionHeight: 720,
      maxBitrate: 4000,
      mediaTitle: 'Test Movie',
      mediaType: 'movie',
      filename: 'test.mp4',
    });

    const res = await request(app)
      .get('/api/transcodes/media/100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].ratingKey).toBe('100');
  });

  it('returns empty array for media with no transcodes', async () => {
    const { token } = await createAdminAndToken(db);

    const res = await request(app)
      .get('/api/transcodes/media/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/transcodes/media/100');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/transcodes - additional edge cases', () => {
  it('returns 404 when media has no source file', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue({
      ...MOCK_METADATA_MOVIE,
      Media: undefined,
    } as any);

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: '720p' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No media found');
  });

  it('returns 400 when resolution is higher than source', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    // Movie at 480p - trying to transcode to 720p should fail
    mockedPlex.getMediaMetadata.mockResolvedValue({
      ...MOCK_METADATA_MOVIE,
      Media: [{
        ...MOCK_METADATA_MOVIE.Media![0],
        height: 480,
        width: 854,
      }],
    } as any);

    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '100', resolutionId: '1080p' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source is only');
  });
});
