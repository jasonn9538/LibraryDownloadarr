import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';
import { MOCK_LIBRARIES, MOCK_LIBRARY_CONTENT } from '../helpers/plex-fixtures';

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
const mockedPlex = vi.mocked(plexService);

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
});

describe('GET /api/libraries', () => {
  it('returns libraries for authenticated admin', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'admin-plex-token');
    mockedPlex.getLibraries.mockResolvedValue(MOCK_LIBRARIES);

    const res = await request(app)
      .get('/api/libraries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.libraries).toHaveLength(3);
    expect(res.body.libraries[0].title).toBe('Movies');
  });

  it('returns libraries for authenticated plex user', async () => {
    const { token } = createPlexUserAndToken(db, { plexToken: 'user-plex-tok' });
    db.setSetting('plex_url', 'http://localhost:32400');
    mockedPlex.getLibraries.mockResolvedValue(MOCK_LIBRARIES);

    const res = await request(app)
      .get('/api/libraries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.libraries).toHaveLength(3);
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);
    // No plex_url set

    const res = await request(app)
      .get('/api/libraries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/libraries');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/libraries/:key/content', () => {
  it('returns paginated content', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'admin-plex-token');
    mockedPlex.getLibraryContent.mockResolvedValue(MOCK_LIBRARY_CONTENT);

    const res = await request(app)
      .get('/api/libraries/1/content?offset=0&limit=20')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toHaveLength(2);
    expect(res.body.totalSize).toBe(50);
    expect(res.body.offset).toBe(0);
    expect(res.body.limit).toBe(20);
  });

  it('passes sort params to plexService', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'admin-plex-token');
    mockedPlex.getLibraryContent.mockResolvedValue(MOCK_LIBRARY_CONTENT);

    await request(app)
      .get('/api/libraries/1/content?sort=addedAt&order=desc')
      .set('Authorization', `Bearer ${token}`);

    expect(mockedPlex.getLibraryContent).toHaveBeenCalledWith(
      '1',
      expect.any(String),
      expect.objectContaining({ sort: 'addedAt', order: 'desc' })
    );
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);

    const res = await request(app)
      .get('/api/libraries/1/content')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/libraries/1/content');
    expect(res.status).toBe(401);
  });
});
