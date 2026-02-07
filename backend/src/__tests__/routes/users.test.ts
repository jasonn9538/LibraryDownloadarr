import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
});

describe('GET /api/users', () => {
  it('returns all users for admin', async () => {
    const { token } = await createAdminAndToken(db);
    // Also create a plex user
    db.createOrUpdatePlexUser({
      username: 'plexuser1',
      email: 'plex@test.com',
      plexToken: 'tok1',
      plexId: 'pid1',
    });

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users.some((u: any) => u.type === 'admin')).toBe(true);
    expect(res.body.users.some((u: any) => u.type === 'plex')).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/users/:userId/admin', () => {
  it('toggles admin status', async () => {
    const { token } = await createAdminAndToken(db);
    const plexUser = db.createOrUpdatePlexUser({
      username: 'plexuser1',
      email: 'plex@test.com',
      plexToken: 'tok1',
      plexId: 'pid1',
    });

    // Promote to admin
    const res = await request(app)
      .patch(`/api/users/${plexUser.id}/admin`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isAdmin: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify in user list
    const usersRes = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    const updated = usersRes.body.users.find((u: any) => u.id === plexUser.id);
    expect(updated.isAdmin).toBe(true);
  });

  it('prevents removing own admin privileges', async () => {
    const { user, token } = await createAdminAndToken(db);
    const res = await request(app)
      .patch(`/api/users/${user.id}/admin`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isAdmin: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('own admin');
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .patch('/api/users/nonexistent-id/admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ isAdmin: true });
    expect(res.status).toBe(404);
  });

  it('returns 400 when isAdmin is not boolean', async () => {
    const { token } = await createAdminAndToken(db);
    const res = await request(app)
      .patch('/api/users/some-id/admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ isAdmin: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('boolean');
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .patch('/api/users/some-id/admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ isAdmin: true });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/users/:userId', () => {
  it('deletes a user', async () => {
    const { token } = await createAdminAndToken(db);
    const plexUser = db.createOrUpdatePlexUser({
      username: 'plexuser1',
      email: 'plex@test.com',
      plexToken: 'tok1',
      plexId: 'pid1',
    });

    const res = await request(app)
      .delete(`/api/users/${plexUser.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify deletion
    const usersRes = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(usersRes.body.users).toHaveLength(1); // Only admin left
  });

  it('prevents deleting self', async () => {
    const { user, token } = await createAdminAndToken(db);
    const res = await request(app)
      .delete(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('own account');
  });

  it('prevents deleting the last admin', async () => {
    const { token } = await createAdminAndToken(db);
    // Create a second admin so we can test deleting the first via admin route
    const { user: admin2 } = await createAdminAndToken(db, {
      username: 'admin2',
      email: 'admin2@localhost',
    });

    // Delete admin2 should work
    const res = await request(app)
      .delete(`/api/users/${admin2.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .delete('/api/users/some-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
