import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken } from '../helpers/auth-helpers';

vi.mock('../../services/plexService', () => ({
  plexService: {
    setServerConnection: vi.fn(),
    getLibraries: vi.fn().mockResolvedValue([]),
    getMediaMetadata: vi.fn().mockResolvedValue({
      ratingKey: '100', title: 'Test', Media: [{ Part: [{ key: '/library/parts/100/file.mkv' }] }],
    }),
    getServerIdentity: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn(),
    testConnectionWithCredentials: vi.fn(),
    getHubs: vi.fn().mockResolvedValue([]),
    getRecentlyAdded: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  },
  getAvailableResolutions: vi.fn().mockReturnValue([]),
  RESOLUTION_PRESETS: [{ id: '720p', label: '720p', height: 720, maxVideoBitrate: 4000 }],
}));

vi.mock('../../services/transcodeManager', () => ({
  transcodeManager: {
    initialize: vi.fn(),
    getMaxConcurrent: vi.fn().mockReturnValue(2),
    setMaxConcurrent: vi.fn(),
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
    getCacheDir: vi.fn().mockReturnValue('/tmp/test-cache'),
    getCacheKey: vi.fn(),
    handleWorkerJobComplete: vi.fn(),
    moveJob: vi.fn(),
  },
}));

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
});

describe('ratingKey validation (path traversal / injection prevention)', () => {
  const badRatingKeys = [
    '../etc/passwd',
    '100; DROP TABLE users',
    '100%00',
    '../../',
    '<script>alert(1)</script>',
    '-1',
    '1.5',
    '100 OR 1=1',
    '100/../../etc/passwd',
    'abc',
    '1e10',
    // Note: empty string '' omitted — Express returns 404 (no route match), which is also safe
  ];

  for (const badKey of badRatingKeys) {
    it(`rejects invalid ratingKey: "${badKey}" on media route`, async () => {
      const { token } = await createAdminAndToken(db);
      const res = await request(app)
        .get(`/api/media/${encodeURIComponent(badKey)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  }

  it('accepts valid numeric ratingKey', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'test-token');
    const res = await request(app)
      .get('/api/media/12345')
      .set('Authorization', `Bearer ${token}`);
    // Should not be 400 (may be 200 or 500 depending on Plex mock)
    expect(res.status).not.toBe(400);
  });
});

describe('ratingKey validation on transcode POST body', () => {
  it('rejects non-numeric ratingKey in body', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '../etc/passwd', resolutionId: '720p' });
    expect(res.status).toBe(400);
  });

  it('rejects empty ratingKey in body', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/transcodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ratingKey: '', resolutionId: '720p' });
    expect(res.status).toBe(400);
  });
});

describe('Thumbnail proxy SSRF prevention', () => {
  const ssrfPaths = [
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/admin',
    '/etc/passwd',
    '/../../../etc/passwd',
    '/admin/secret',
    'file:///etc/passwd',
    '/library/metadata/../../etc/passwd',
    'http://internal-service:3000/secret',
  ];

  for (const badPath of ssrfPaths) {
    it(`rejects SSRF attempt: "${badPath}"`, async () => {
      const { token } = await createAdminAndToken(db);
      const res = await request(app)
        .get(`/api/media/thumb/100?path=${encodeURIComponent(badPath)}&token=${token}`);
      expect(res.status).toBe(400);
    });
  }

  it('rejects paths with null bytes', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get(`/api/media/thumb/100?path=${encodeURIComponent('/library/metadata/123/thumb\0/etc/passwd')}&token=${token}`);
    expect(res.status).toBe(400);
  });

  it('rejects paths with directory traversal (..)', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get(`/api/media/thumb/100?path=${encodeURIComponent('/library/metadata/123/../../../etc/passwd')}&token=${token}`);
    expect(res.status).toBe(400);
  });

  it('accepts valid Plex thumbnail paths', async () => {
    const { token } = await createAdminAndToken(db);
    db.setSetting('plex_url', 'http://localhost:32400');
    db.setSetting('plex_token', 'admin-plex-token');
    const res = await request(app)
      .get(`/api/media/thumb/100?path=${encodeURIComponent('/library/metadata/12345/thumb/1234567890')}&token=${token}`);
    // Should not be 400 (validation passed; may be 500 from network error)
    expect(res.status).not.toBe(400);
  });
});

describe('Prototype pollution prevention', () => {
  it('__proto__ in login body does not pollute Object', async () => {
    await createAdminAndToken(db);
    await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'TestPass123!xx',
        __proto__: { isAdmin: true },
      });
    expect(({} as any).isAdmin).toBeUndefined();
  });

  it('constructor.prototype in settings body does not pollute Object', async () => {
    const { token } = await createAdminAndToken(db);
    await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plexUrl: 'http://localhost:32400',
        constructor: { prototype: { isAdmin: true } },
      });
    expect(({} as any).isAdmin).toBeUndefined();
  });
});
