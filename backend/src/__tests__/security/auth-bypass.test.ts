import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken, createPlexUser } from '../helpers/auth-helpers';

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
  },
  getAvailableResolutions: vi.fn().mockReturnValue([]),
  RESOLUTION_PRESETS: [],
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

describe('Authentication bypass attempts', () => {
  const protectedEndpoints = [
    { method: 'get' as const, path: '/api/libraries' },
    { method: 'get' as const, path: '/api/media/recently-added' },
    { method: 'get' as const, path: '/api/media/search?q=test' },
    { method: 'get' as const, path: '/api/transcodes' },
    { method: 'get' as const, path: '/api/settings' },
    { method: 'get' as const, path: '/api/users' },
    { method: 'get' as const, path: '/api/logs' },
  ];

  for (const { method, path } of protectedEndpoints) {
    it(`${method.toUpperCase()} ${path} rejects with no token`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    });

    it(`${method.toUpperCase()} ${path} rejects with empty Bearer`, async () => {
      const res = await request(app)[method](path)
        .set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });

    it(`${method.toUpperCase()} ${path} rejects with malformed auth header`, async () => {
      const res = await request(app)[method](path)
        .set('Authorization', 'NotBearer sometoken');
      expect(res.status).toBe(401);
    });

    it(`${method.toUpperCase()} ${path} rejects with deleted session`, async () => {
      const { token } = await createAdminAndToken(db);
      db.deleteSession(token);
      const res = await request(app)[method](path)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  }
});

describe('Privilege escalation — non-admin accessing admin endpoints', () => {
  const adminOnlyEndpoints = [
    { method: 'get' as const, path: '/api/settings' },
    { method: 'get' as const, path: '/api/users' },
    { method: 'get' as const, path: '/api/logs' },
    { method: 'get' as const, path: '/api/media/download-history/all' },
    { method: 'get' as const, path: '/api/settings/workers' },
    { method: 'post' as const, path: '/api/settings/workers/generate-key' },
  ];

  for (const { method, path } of adminOnlyEndpoints) {
    it(`${method.toUpperCase()} ${path} returns 403 for non-admin`, async () => {
      const { token } = createPlexUserAndToken(db);
      const res = await request(app)[method](path)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  }
});

describe('Cross-user data isolation', () => {
  it('user A cannot see user B download history', async () => {
    const { user: userA } = await createAdminAndToken(db);
    const { token: tokenB } = createPlexUserAndToken(db, { username: 'userB' });

    db.logDownload(userA.id, 'Admin Movie', '100', 1000);

    const res = await request(app)
      .get('/api/media/download-history')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(0);
  });

  it('non-admin cannot delete other users', async () => {
    const { user: adminUser } = await createAdminAndToken(db);
    const { token: plexToken } = createPlexUserAndToken(db);

    const res = await request(app)
      .delete(`/api/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${plexToken}`);
    expect(res.status).toBe(403);
  });

  it('non-admin cannot grant admin privileges', async () => {
    const plexUser = createPlexUser(db, { username: 'target' });
    const { token: attackerToken } = createPlexUserAndToken(db, { username: 'attacker' });

    const res = await request(app)
      .patch(`/api/users/${plexUser.id}/admin`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ isAdmin: true });
    expect(res.status).toBe(403);
  });
});

describe('Session security', () => {
  it('session tokens have sufficient entropy', async () => {
    const { token: token1 } = await createAdminAndToken(db);
    const { token: token2 } = await createAdminAndToken(db, { username: 'admin2' });
    expect(token1.length).toBeGreaterThanOrEqual(36);
    expect(token2.length).toBeGreaterThanOrEqual(36);
    expect(token1).not.toBe(token2);
  });

  it('cannot reuse deleted session token', async () => {
    const { token } = await createAdminAndToken(db);
    const res1 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(200);

    db.deleteSession(token);

    const res2 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(401);
  });

  it('password change invalidates other sessions', async () => {
    const { user, token, password } = await createAdminAndToken(db);
    const session2 = db.createSession(user.id);

    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'NewSecurePass123!' });

    // Other session should be invalidated
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session2.token}`);
    expect(res.status).toBe(401);
  });

  it('does not reveal whether username exists via different errors', async () => {
    const { app: freshApp, db: freshDb } = createTestApp();
    await createAdminAndToken(freshDb);

    const resWrongUser = await request(freshApp)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'WrongPass1' });

    const resWrongPass = await request(freshApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'WrongPass1' });

    // Both return same error message (no user enumeration)
    expect(resWrongUser.body.error).toBe(resWrongPass.body.error);
  });
});
