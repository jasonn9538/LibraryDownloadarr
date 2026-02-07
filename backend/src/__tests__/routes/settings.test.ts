import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';

// Mock plexService and transcodeManager
vi.mock('../../services/plexService', () => ({
  plexService: {
    setServerConnection: vi.fn(),
    getServerIdentity: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn().mockResolvedValue(true),
    testConnectionWithCredentials: vi.fn().mockResolvedValue(true),
    generatePin: vi.fn(),
    checkPin: vi.fn(),
    getUserServers: vi.fn(),
    findBestServerConnection: vi.fn(),
    getLibraries: vi.fn(),
    getLibraryContent: vi.fn(),
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
  RESOLUTION_PRESETS: [],
}));

vi.mock('../../services/transcodeManager', () => ({
  transcodeManager: {
    getMaxConcurrent: vi.fn().mockReturnValue(2),
    setMaxConcurrent: vi.fn(),
    initialize: vi.fn(),
    getUserJobs: vi.fn().mockReturnValue([]),
    getAllTranscodes: vi.fn().mockReturnValue([]),
    getAllAvailableTranscodes: vi.fn().mockReturnValue([]),
    getJobCounts: vi.fn().mockReturnValue({ pending: 0, transcoding: 0, completed: 0, error: 0 }),
    getJob: vi.fn(),
    queueTranscode: vi.fn(),
    deleteJob: vi.fn(),
    getProgress: vi.fn(),
    streamCompletedJob: vi.fn(),
    shutdown: vi.fn(),
  },
}));

import { plexService } from '../../services/plexService';
import { transcodeManager } from '../../services/transcodeManager';
const mockedPlex = vi.mocked(plexService);
const mockedTranscode = vi.mocked(transcodeManager);

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
  mockedTranscode.getMaxConcurrent.mockReturnValue(2);
});

describe('GET /api/settings', () => {
  it('returns settings for admin', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');

    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings.plexUrl).toBe('http://localhost:32400');
    expect(res.body.settings.maxConcurrentTranscodes).toBe(2);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/settings', () => {
  it('updates plexUrl', async () => {
    const { token } = await createAdminAndToken(db);
    mockedPlex.getServerIdentity.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ plexUrl: 'http://newplex:32400' });
    expect(res.status).toBe(200);
    expect(db.getSetting('plex_url')).toBe('http://newplex:32400');
  });

  it('updates plexToken', async () => {
    const { token } = await createAdminAndToken(db);
    mockedPlex.getServerIdentity.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ plexUrl: 'http://localhost:32400', plexToken: 'new-plex-token' });
    expect(res.status).toBe(200);
    expect(db.getSetting('plex_token')).toBe('new-plex-token');
  });

  it('updates pathMappings', async () => {
    const { token } = await createAdminAndToken(db);
    const mappings = [{ plexPath: '/media', localPath: '/mnt/media' }];

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pathMappings: mappings });
    expect(res.status).toBe(200);

    const saved = JSON.parse(db.getSetting('path_mappings') || '[]');
    expect(saved).toEqual(mappings);
  });

  it('updates maxConcurrentTranscodes within range', async () => {
    const { token } = await createAdminAndToken(db);

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxConcurrentTranscodes: 5 });
    expect(res.status).toBe(200);
    expect(mockedTranscode.setMaxConcurrent).toHaveBeenCalledWith(5);
    expect(db.getSetting('max_concurrent_transcodes')).toBe('5');
  });

  it('rejects maxConcurrentTranscodes out of range', async () => {
    const { token } = await createAdminAndToken(db);

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxConcurrentTranscodes: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('between 1 and 10');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ plexUrl: 'http://test:32400' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ plexUrl: 'http://test:32400' });
    expect(res.status).toBe(403);
  });

  it('auto-fetches server identity when URL and token are both set', async () => {
    const { token } = await createAdminAndToken(db);
    mockedPlex.getServerIdentity.mockResolvedValue({
      machineIdentifier: 'abc123',
      friendlyName: 'My Server',
    });

    await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ plexUrl: 'http://plex:32400', plexToken: 'token123' });

    expect(mockedPlex.setServerConnection).toHaveBeenCalled();
    expect(mockedPlex.getServerIdentity).toHaveBeenCalled();
    expect(db.getSetting('plex_machine_id')).toBe('abc123');
    expect(db.getSetting('plex_server_name')).toBe('My Server');
  });
});

describe('POST /api/settings/test-connection', () => {
  it('tests saved connection', async () => {
    const { token } = await createAdminAndToken(db);
    mockedPlex.testConnection.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/settings/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('tests provided credentials', async () => {
    const { token } = await createAdminAndToken(db);
    mockedPlex.testConnectionWithCredentials.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/settings/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ plexUrl: 'http://test:32400', plexToken: 'test-token' });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(mockedPlex.testConnectionWithCredentials).toHaveBeenCalledWith('http://test:32400', 'test-token');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/settings/test-connection')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .post('/api/settings/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
