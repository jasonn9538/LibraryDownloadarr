import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';
import {
  MOCK_METADATA_MOVIE,
  MOCK_METADATA_EPISODE,
  MOCK_SEASONS,
  MOCK_EPISODES,
  MOCK_TRACKS,
  MOCK_SEARCH_RESULTS,
} from '../helpers/plex-fixtures';

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
  getAvailableResolutions: vi.fn().mockReturnValue([
    { id: '720p', label: '720p', height: 720, width: 1280, maxVideoBitrate: 4000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
    { id: '480p', label: '480p', height: 480, width: 854, maxVideoBitrate: 2000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
  ]),
  RESOLUTION_PRESETS: [
    { id: '1080p', label: '1080p', height: 1080, width: 1920, maxVideoBitrate: 8000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
    { id: '720p', label: '720p', height: 720, width: 1280, maxVideoBitrate: 4000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
    { id: '480p', label: '480p', height: 480, width: 854, maxVideoBitrate: 2000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4' },
  ],
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

function setupPlexSettings() {
  db.setSetting('plex_url', 'http://localhost:32400');
  db.setSetting('plex_token', 'admin-plex-token');
}

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
});

describe('GET /api/media/recently-added', () => {
  it('returns recently added media', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getRecentlyAdded.mockResolvedValue([MOCK_METADATA_MOVIE, MOCK_METADATA_EPISODE]);

    const res = await request(app)
      .get('/api/media/recently-added')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(2);
  });

  it('respects limit parameter', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getRecentlyAdded.mockResolvedValue([MOCK_METADATA_MOVIE]);

    await request(app)
      .get('/api/media/recently-added?limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(mockedPlex.getRecentlyAdded).toHaveBeenCalledWith(expect.any(String), 5);
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get('/api/media/recently-added')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/media/recently-added');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/media/search', () => {
  it('returns search results', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.search.mockResolvedValue(MOCK_SEARCH_RESULTS as any);

    const res = await request(app)
      .get('/api/media/search?q=test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });

  it('returns 400 for short query', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .get('/api/media/search?q=a')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2 characters');
  });

  it('returns 400 when query is missing', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();

    const res = await request(app)
      .get('/api/media/search')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get('/api/media/search?q=test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/media/search?q=test');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/media/:ratingKey', () => {
  it('returns media metadata', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue(MOCK_METADATA_MOVIE as any);

    const res = await request(app)
      .get('/api/media/100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.metadata.title).toBe('Test Movie');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/media/100');
    expect(res.status).toBe(401);
  });

  it('returns 403 when Plex not configured', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get('/api/media/100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/media/:ratingKey/seasons', () => {
  it('returns seasons', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getSeasons.mockResolvedValue(MOCK_SEASONS as any);

    const res = await request(app)
      .get('/api/media/250/seasons')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.seasons).toHaveLength(2);
  });
});

describe('GET /api/media/:ratingKey/episodes', () => {
  it('returns episodes', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getEpisodes.mockResolvedValue(MOCK_EPISODES as any);

    const res = await request(app)
      .get('/api/media/300/episodes')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.episodes).toHaveLength(2);
  });
});

describe('GET /api/media/:ratingKey/tracks', () => {
  it('returns tracks', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getTracks.mockResolvedValue(MOCK_TRACKS as any);

    const res = await request(app)
      .get('/api/media/500/tracks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(2);
  });
});

describe('GET /api/media/:ratingKey/resolutions', () => {
  it('returns resolution options with caps', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue(MOCK_METADATA_MOVIE as any);

    const res = await request(app)
      .get('/api/media/100/resolutions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.resolutions).toBeDefined();
    // First should be "Original"
    expect(res.body.resolutions[0].isOriginal).toBe(true);
    expect(res.body.source.height).toBe(1080);
  });

  it('returns 404 when no media found', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.getMediaMetadata.mockResolvedValue({ title: 'No Media Item' } as any);

    const res = await request(app)
      .get('/api/media/999/resolutions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No media found');
  });
});

describe('GET /api/media/search - edge cases', () => {
  it('handles empty results from Plex', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.search.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/media/search?q=nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('handles non-array results from Plex gracefully', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    mockedPlex.search.mockResolvedValue(null as any);

    const res = await request(app)
      .get('/api/media/search?q=test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });
});

describe('GET /api/media/:ratingKey/resolutions - edge cases', () => {
  it('caps bitrate to source bitrate', async () => {
    const { token } = await createAdminAndToken(db);
    setupPlexSettings();
    // Low bitrate source (1 Mbps at 1080p)
    mockedPlex.getMediaMetadata.mockResolvedValue({
      ...MOCK_METADATA_MOVIE,
      Media: [{
        ...MOCK_METADATA_MOVIE.Media![0],
        bitrate: 1000, // 1 Mbps
      }],
    } as any);

    const res = await request(app)
      .get('/api/media/100/resolutions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // All non-original resolutions should be capped at 1000
    const nonOriginal = res.body.resolutions.filter((r: any) => !r.isOriginal);
    for (const r of nonOriginal) {
      expect(r.maxVideoBitrate).toBeLessThanOrEqual(1000);
    }
  });
});

describe('GET /api/media/download-history', () => {
  it('returns own download history', async () => {
    const { user, token } = await createAdminAndToken(db);
    db.logDownload(user.id, 'Test Movie', '100', 1000000);

    const res = await request(app)
      .get('/api/media/download-history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].media_title).toBe('Test Movie');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/media/download-history');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/media/download-history/all', () => {
  it('returns all history for admin', async () => {
    const { user, token } = await createAdminAndToken(db);
    db.logDownload(user.id, 'Test Movie', '100', 1000000);

    const plexUser = db.createOrUpdatePlexUser({
      username: 'plex1', email: 'p@t.com', plexToken: 't1', plexId: 'p1',
    });
    db.logDownload(plexUser.id, 'Other Movie', '101', 2000000);

    const res = await request(app)
      .get('/api/media/download-history/all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .get('/api/media/download-history/all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/media/download-stats', () => {
  it('returns global download stats', async () => {
    const { user, token } = await createAdminAndToken(db);
    db.logDownload(user.id, 'Test Movie', '100', 1000000);
    db.logDownload(user.id, 'Another Movie', '101', 2000000);

    const res = await request(app)
      .get('/api/media/download-stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.count).toBe(2);
    expect(res.body.stats.total_size).toBe(3000000);
  });

  it('returns zero counts when no downloads', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get('/api/media/download-stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.count).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/media/download-stats');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/media/download-history - user isolation', () => {
  it('only returns own downloads, not other users', async () => {
    const { user, token } = await createAdminAndToken(db);
    const plexUser = db.createOrUpdatePlexUser({
      username: 'plex1', email: 'p@t.com', plexToken: 't1', plexId: 'p1',
    });

    db.logDownload(user.id, 'My Movie', '100', 1000000);
    db.logDownload(plexUser.id, 'Their Movie', '101', 2000000);

    const res = await request(app)
      .get('/api/media/download-history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].media_title).toBe('My Movie');
  });
});
