import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminUser, createAdminAndToken, STRONG_PASSWORD } from '../helpers/auth-helpers';

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
});

describe('GET /api/auth/setup/required', () => {
  it('returns setupRequired true when no admin exists', async () => {
    const res = await request(app).get('/api/auth/setup/required');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(true);
  });

  it('returns setupRequired false after admin is created', async () => {
    await createAdminUser(db);
    const res = await request(app).get('/api/auth/setup/required');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(false);
  });
});

describe('GET /api/auth/admin-login-enabled', () => {
  it('returns enabled true from local request', async () => {
    const res = await request(app).get('/api/auth/admin-login-enabled');
    expect(res.status).toBe(200);
    // Supertest comes from 127.0.0.1 which is a local IP
    expect(res.body.enabled).toBe(true);
  });
});

describe('POST /api/auth/setup', () => {
  it('creates admin user successfully', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin', password: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.isAdmin).toBe(true);
    expect(res.body.token).toBeDefined();
  });

  it('returns 400 when missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  it('returns 400 for weak password (too short)', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin', password: 'Short1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('12 characters');
  });

  it('returns 400 for password missing complexity', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin', password: 'alllowercaseeee' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('uppercase');
  });

  it('returns 400 for password missing number', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin', password: 'AllLettersOnly!!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if setup already completed', async () => {
    await createAdminUser(db);
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin2', password: STRONG_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already completed');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in successfully with valid credentials', async () => {
    const { password } = await createAdminUser(db);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
    expect(res.body.token).toBeDefined();
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  it('returns 401 for wrong username', async () => {
    await createAdminUser(db);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'wronguser', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid credentials');
  });

  it('returns 401 for wrong password', async () => {
    await createAdminUser(db);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'WrongPassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid credentials');
  });

  it('locks out after 5 failed attempts', async () => {
    await createAdminUser(db);

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'WrongPassword123' });
    }

    // 6th attempt should be 429
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'WrongPassword123' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many failed');
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user with valid token', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.isAdmin).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  it('supports token via query parameter', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app).get(`/api/auth/me?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
  });

  it('returns Plex user details for Plex session', async () => {
    const plexUser = db.createOrUpdatePlexUser({
      username: 'plextest', email: 'p@t.com', plexToken: 'tok', plexId: 'pid1',
    });
    const session = db.createSession(plexUser.id);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('plextest');
    expect(res.body.user.isAdmin).toBe(false);
  });
});

describe('POST /api/auth/logout', () => {
  it('invalidates the session token', async () => {
    const { token } = await createAdminAndToken(db);

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);

    // Token should now be invalid
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  const NEW_PASSWORD = 'NewSecure123!xx';

  it('changes password successfully', async () => {
    const { token, password } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('changed successfully');
  });

  it('returns 400 for missing fields', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'something' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  it('returns 400 for wrong current password', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongCurrent1', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('incorrect');
  });

  it('returns 400 for weak new password', async () => {
    const { token, password } = await createAdminAndToken(db);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('12 characters');
  });

  it('rejects change-password for Plex users', async () => {
    // Create a plex user with a session
    const plexUser = db.createOrUpdatePlexUser({
      username: 'plextest',
      email: 'plex@test.com',
      plexToken: 'abc',
      plexId: 'plex-123',
    });
    const session = db.createSession(plexUser.id);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ currentPassword: 'anything', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('admin accounts');
  });

  it('invalidates other sessions after password change', async () => {
    const { user, token, password } = await createAdminAndToken(db);

    // Create a second session
    const session2 = db.createSession(user.id);

    // Change password using first token
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: NEW_PASSWORD });

    // Second session should be invalidated
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session2.token}`);
    expect(meRes.status).toBe(401);

    // First session should still work
    const meRes2 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes2.status).toBe(200);
  });
});
