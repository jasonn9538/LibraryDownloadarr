import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseService } from '../../models/database';

let db: DatabaseService;

beforeEach(() => {
  db = new DatabaseService(':memory:');
});

describe('DatabaseService', () => {
  describe('Admin user operations', () => {
    it('creates an admin user and retrieves by username', () => {
      const user = db.createAdminUser({
        username: 'admin',
        passwordHash: 'hash123',
        email: 'admin@test.com',
        isAdmin: true,
      });
      expect(user.id).toBeDefined();
      expect(user.username).toBe('admin');

      const found = db.getAdminUserByUsername('admin');
      expect(found).toBeDefined();
      expect(found!.username).toBe('admin');
      expect(found!.passwordHash).toBe('hash123');
    });

    it('retrieves admin user by ID', () => {
      const user = db.createAdminUser({
        username: 'admin',
        passwordHash: 'hash',
        email: 'a@t.com',
        isAdmin: true,
      });
      const found = db.getAdminUserById(user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
    });

    it('returns undefined for non-existent username', () => {
      expect(db.getAdminUserByUsername('nonexistent')).toBeUndefined();
    });

    it('returns undefined for non-existent ID', () => {
      expect(db.getAdminUserById('nonexistent')).toBeUndefined();
    });

    it('hasAdminUser returns false when empty', () => {
      expect(db.hasAdminUser()).toBe(false);
    });

    it('hasAdminUser returns true after creating admin', () => {
      db.createAdminUser({ username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      expect(db.hasAdminUser()).toBe(true);
    });

    it('hasAdminUser returns false for non-admin users', () => {
      db.createAdminUser({ username: 'user', passwordHash: 'h', email: 'u@t.com', isAdmin: false });
      expect(db.hasAdminUser()).toBe(false);
    });

    it('updates last login timestamp', () => {
      const user = db.createAdminUser({ username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      db.updateAdminLastLogin(user.id);
      const found = db.getAdminUserById(user.id);
      expect(found!.lastLogin).toBeGreaterThan(0);
    });

    it('updates password hash', () => {
      const user = db.createAdminUser({ username: 'admin', passwordHash: 'old', email: 'a@t.com', isAdmin: true });
      db.updateAdminPassword(user.id, 'newhash');
      const found = db.getAdminUserById(user.id);
      expect(found!.passwordHash).toBe('newhash');
    });
  });

  describe('Plex user operations', () => {
    it('creates a new Plex user', () => {
      const user = db.createOrUpdatePlexUser({
        username: 'plexuser',
        email: 'plex@t.com',
        plexToken: 'tok',
        plexId: 'pid1',
      });
      expect(user.id).toBeDefined();
      expect(user.username).toBe('plexuser');
      expect(user.isAdmin).toBe(false);
    });

    it('updates existing Plex user on re-login (by plexId)', () => {
      db.createOrUpdatePlexUser({
        username: 'plexuser',
        email: 'old@t.com',
        plexToken: 'tok1',
        plexId: 'pid1',
      });

      const updated = db.createOrUpdatePlexUser({
        username: 'plexuser',
        email: 'new@t.com',
        plexToken: 'tok2',
        plexId: 'pid1',
      });

      expect(updated.email).toBe('new@t.com');
      // Should not create a second user
      const all = db.getAllUsers().filter(u => u.type === 'plex');
      expect(all).toHaveLength(1);
    });

    it('retrieves Plex user by plexId', () => {
      db.createOrUpdatePlexUser({
        username: 'plex',
        email: 'p@t.com',
        plexToken: 'tok',
        plexId: 'pid1',
      });
      const found = db.getPlexUserByPlexId('pid1');
      expect(found).toBeDefined();
      expect(found!.username).toBe('plex');
    });

    it('retrieves Plex user by username', () => {
      db.createOrUpdatePlexUser({
        username: 'plex',
        email: 'p@t.com',
        plexToken: 'tok',
        plexId: 'pid1',
      });
      const found = db.getPlexUserByUsername('plex');
      expect(found).toBeDefined();
    });
  });

  describe('Session operations', () => {
    it('creates and retrieves a session', () => {
      const user = db.createAdminUser({ username: 'a', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      const session = db.createSession(user.id);
      expect(session.token).toBeDefined();
      expect(session.userId).toBe(user.id);

      const found = db.getSessionByToken(session.token);
      expect(found).toBeDefined();
      expect(found!.userId).toBe(user.id);
    });

    it('returns undefined for non-existent session token', () => {
      expect(db.getSessionByToken('nonexistent')).toBeUndefined();
    });

    it('deletes a session', () => {
      const user = db.createAdminUser({ username: 'a', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      const session = db.createSession(user.id);
      db.deleteSession(session.token);
      expect(db.getSessionByToken(session.token)).toBeUndefined();
    });

    it('deletes all user sessions except specified token', () => {
      const user = db.createAdminUser({ username: 'a', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      const s1 = db.createSession(user.id);
      const s2 = db.createSession(user.id);

      db.deleteUserSessions(user.id, s1.token);

      expect(db.getSessionByToken(s1.token)).toBeDefined();
      expect(db.getSessionByToken(s2.token)).toBeUndefined();
    });
  });

  describe('Settings operations', () => {
    it('sets and gets a setting', () => {
      db.setSetting('key1', 'value1');
      expect(db.getSetting('key1')).toBe('value1');
    });

    it('returns undefined for non-existent setting', () => {
      expect(db.getSetting('nonexistent')).toBeUndefined();
    });

    it('updates existing setting', () => {
      db.setSetting('key1', 'old');
      db.setSetting('key1', 'new');
      expect(db.getSetting('key1')).toBe('new');
    });
  });

  describe('Download logs', () => {
    it('logs and retrieves downloads', () => {
      db.createAdminUser({ username: 'a', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      const user = db.getAdminUserByUsername('a')!;

      db.logDownload(user.id, 'Movie 1', '100', 1000000);
      db.logDownload(user.id, 'Movie 2', '101', 2000000);

      const history = db.getDownloadHistory(user.id);
      expect(history).toHaveLength(2);
      // Verify both downloads are present
      const titles = history.map((h: any) => h.media_title);
      expect(titles).toContain('Movie 1');
      expect(titles).toContain('Movie 2');
    });

    it('returns download stats', () => {
      const user = db.createAdminUser({ username: 'a', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      db.logDownload(user.id, 'Movie 1', '100', 1000000);
      db.logDownload(user.id, 'Movie 2', '101', 2000000);

      const stats = db.getDownloadStats();
      expect(stats.count).toBe(2);
      expect(stats.total_size).toBe(3000000);
    });

    it('returns stats filtered by user', () => {
      const user1 = db.createAdminUser({ username: 'a1', passwordHash: 'h', email: 'a1@t.com', isAdmin: true });
      const user2 = db.createOrUpdatePlexUser({ username: 'p', email: 'p@t.com', plexToken: 't', plexId: 'p1' });

      db.logDownload(user1.id, 'Movie 1', '100', 1000000);
      db.logDownload(user2.id, 'Movie 2', '101', 2000000);

      const stats = db.getDownloadStats(user1.id);
      expect(stats.count).toBe(1);
      expect(stats.total_size).toBe(1000000);
    });
  });

  describe('Transcode job operations', () => {
    it('creates and retrieves a transcode job', () => {
      const job = db.createTranscodeJob({
        userId: 'user1',
        ratingKey: '100',
        resolutionId: '720p',
        resolutionLabel: '720p',
        resolutionHeight: 720,
        maxBitrate: 4000,
        mediaTitle: 'Test Movie',
        mediaType: 'movie',
        filename: 'test.mp4',
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);

      const found = db.getTranscodeJob(job.id);
      expect(found).toBeDefined();
      expect(found!.mediaTitle).toBe('Test Movie');
    });

    it('retrieves job by cache key', () => {
      db.createTranscodeJob({
        userId: 'u1', ratingKey: '100', resolutionId: '720p', resolutionLabel: '720p',
        resolutionHeight: 720, maxBitrate: 4000, mediaTitle: 'M', mediaType: 'movie', filename: 'f.mp4',
      });

      const found = db.getTranscodeJobByCacheKey('100', '720p');
      expect(found).toBeDefined();
      expect(found!.ratingKey).toBe('100');
    });

    it('updates job status and progress', () => {
      const job = db.createTranscodeJob({
        userId: 'u1', ratingKey: '100', resolutionId: '720p', resolutionLabel: '720p',
        resolutionHeight: 720, maxBitrate: 4000, mediaTitle: 'M', mediaType: 'movie', filename: 'f.mp4',
      });

      db.updateTranscodeJobStatus(job.id, 'transcoding', { startedAt: Date.now(), progress: 50 });
      const updated = db.getTranscodeJob(job.id);
      expect(updated!.status).toBe('transcoding');
      expect(updated!.progress).toBe(50);
    });

    it('gets job counts by status', () => {
      db.createTranscodeJob({
        userId: 'u1', ratingKey: '100', resolutionId: '720p', resolutionLabel: '720p',
        resolutionHeight: 720, maxBitrate: 4000, mediaTitle: 'M1', mediaType: 'movie', filename: 'f1.mp4',
      });
      const job2 = db.createTranscodeJob({
        userId: 'u1', ratingKey: '101', resolutionId: '720p', resolutionLabel: '720p',
        resolutionHeight: 720, maxBitrate: 4000, mediaTitle: 'M2', mediaType: 'movie', filename: 'f2.mp4',
      });
      db.updateTranscodeJobStatus(job2.id, 'completed', {
        completedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
      });

      const counts = db.getTranscodeJobCounts();
      expect(counts.pending).toBe(1);
      expect(counts.completed).toBe(1);
    });

    it('deletes a transcode job', () => {
      const job = db.createTranscodeJob({
        userId: 'u1', ratingKey: '100', resolutionId: '720p', resolutionLabel: '720p',
        resolutionHeight: 720, maxBitrate: 4000, mediaTitle: 'M', mediaType: 'movie', filename: 'f.mp4',
      });
      db.deleteTranscodeJob(job.id);
      expect(db.getTranscodeJob(job.id)).toBeUndefined();
    });
  });

  describe('Failed login attempts (brute force protection)', () => {
    it('records and retrieves failed attempts', () => {
      const result = db.recordFailedAttempt('1.2.3.4', 5, 300000);
      expect(result.blocked).toBe(false);
      expect(result.attemptsRemaining).toBe(4);

      const attempts = db.getFailedAttempts('1.2.3.4');
      expect(attempts).toBeDefined();
      expect(attempts!.count).toBe(1);
    });

    it('blocks IP after max attempts', () => {
      for (let i = 0; i < 4; i++) {
        db.recordFailedAttempt('1.2.3.4', 5, 300000);
      }
      const result = db.recordFailedAttempt('1.2.3.4', 5, 300000);
      expect(result.blocked).toBe(true);
      expect(result.attemptsRemaining).toBe(0);
    });

    it('isIpBlocked returns true for locked IP', () => {
      for (let i = 0; i < 5; i++) {
        db.recordFailedAttempt('1.2.3.4', 5, 300000);
      }
      const check = db.isIpBlocked('1.2.3.4');
      expect(check.blocked).toBe(true);
      expect(check.remainingMs).toBeGreaterThan(0);
    });

    it('clears failed attempts', () => {
      db.recordFailedAttempt('1.2.3.4', 5, 300000);
      db.clearFailedAttempts('1.2.3.4');
      expect(db.getFailedAttempts('1.2.3.4')).toBeUndefined();
    });

    it('isIpBlocked returns false for unknown IP', () => {
      expect(db.isIpBlocked('unknown').blocked).toBe(false);
    });
  });

  describe('User management', () => {
    it('getAllUsers returns both admin and plex users sorted by activity', () => {
      db.createAdminUser({ username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      db.createOrUpdatePlexUser({ username: 'plex1', email: 'p@t.com', plexToken: 't', plexId: 'p1' });

      const users = db.getAllUsers();
      expect(users).toHaveLength(2);
      expect(users.some(u => u.type === 'admin')).toBe(true);
      expect(users.some(u => u.type === 'plex')).toBe(true);
    });

    it('updateUserAdmin toggles admin status', () => {
      const user = db.createOrUpdatePlexUser({ username: 'plex', email: 'p@t.com', plexToken: 't', plexId: 'p1' });
      expect(db.getAllUsers().find(u => u.id === user.id)!.isAdmin).toBe(false);

      db.updateUserAdmin(user.id, true);
      expect(db.getAllUsers().find(u => u.id === user.id)!.isAdmin).toBe(true);
    });

    it('deleteUser removes user and their sessions', () => {
      const user = db.createOrUpdatePlexUser({ username: 'plex', email: 'p@t.com', plexToken: 't', plexId: 'p1' });
      const session = db.createSession(user.id);

      const deleted = db.deleteUser(user.id);
      expect(deleted).toBe(true);
      expect(db.getPlexUserById(user.id)).toBeUndefined();
      expect(db.getSessionByToken(session.token)).toBeUndefined();
    });

    it('deleteUser prevents deleting last admin', () => {
      const admin = db.createAdminUser({ username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true });
      const deleted = db.deleteUser(admin.id);
      expect(deleted).toBe(false);
    });
  });

  describe('Audit log', () => {
    it('logs and retrieves audit events', () => {
      db.logAuditEvent('login_success', 'user1', 'admin', '127.0.0.1', { method: 'password' });
      db.logAuditEvent('login_failed', undefined, undefined, '1.2.3.4');

      const log = db.getAuditLog();
      expect(log).toHaveLength(2);
      expect(log[0].action).toBe('login_failed'); // Most recent first
    });

    it('filters audit log by action', () => {
      db.logAuditEvent('login_success', 'user1', 'admin', '127.0.0.1');
      db.logAuditEvent('login_failed', undefined, undefined, '1.2.3.4');

      const log = db.getAuditLog(100, 'login_success');
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe('login_success');
    });
  });

  describe('Worker operations', () => {
    it('creates and retrieves a worker', () => {
      const worker = db.createWorker({
        id: 'worker-1',
        name: 'test-worker',
        capabilities: JSON.stringify({ gpu: 'NVIDIA', encoders: ['h264_nvenc'] }),
      });

      expect(worker.id).toBe('worker-1');
      expect(worker.name).toBe('test-worker');
      expect(worker.status).toBe('online');

      const found = db.getWorker('worker-1');
      expect(found).toBeDefined();
      expect(found!.name).toBe('test-worker');
    });

    it('lists all workers', () => {
      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.createWorker({ id: 'w2', name: 'worker-2' });

      const workers = db.getWorkers();
      expect(workers).toHaveLength(2);
    });

    it('deletes a worker', () => {
      db.createWorker({ id: 'w1', name: 'worker-1' });
      expect(db.deleteWorker('w1')).toBe(true);
      expect(db.getWorker('w1')).toBeUndefined();
    });

    it('returns false when deleting non-existent worker', () => {
      expect(db.deleteWorker('nonexistent')).toBe(false);
    });

    it('updates worker heartbeat', () => {
      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.updateWorkerHeartbeat('w1', 3);

      const worker = db.getWorker('w1');
      expect(worker!.activeJobs).toBe(3);
      expect(worker!.status).toBe('online');
      expect(worker!.lastHeartbeat).toBeGreaterThan(0);
    });

    it('updates worker status', () => {
      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.updateWorkerStatus('w1', 'offline');

      const worker = db.getWorker('w1');
      expect(worker!.status).toBe('offline');
    });

    it('re-registers (upserts) an existing worker', () => {
      db.createWorker({ id: 'w1', name: 'original' });
      db.createWorker({ id: 'w1', name: 'updated' });

      const workers = db.getWorkers();
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe('updated');
    });
  });

  describe('Worker job claim', () => {
    it('atomically claims a pending job', () => {
      // Create a transcode job
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      db.createWorker({ id: 'w1', name: 'worker-1' });
      const claimed = db.claimTranscodeJobForWorker('w1');

      expect(claimed).toBeDefined();
      expect(claimed!.status).toBe('transcoding');
      expect(claimed!.workerId).toBe('w1');
      expect(claimed!.assignedAt).toBeGreaterThan(0);
    });

    it('returns undefined when no pending jobs', () => {
      db.createWorker({ id: 'w1', name: 'worker-1' });
      const claimed = db.claimTranscodeJobForWorker('w1');
      expect(claimed).toBeUndefined();
    });

    it('only one worker can claim the same job', () => {
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.createWorker({ id: 'w2', name: 'worker-2' });

      const claimed1 = db.claimTranscodeJobForWorker('w1');
      const claimed2 = db.claimTranscodeJobForWorker('w2');

      expect(claimed1).toBeDefined();
      expect(claimed2).toBeUndefined();
    });

    it('excludes worker-claimed jobs from local pending queue', () => {
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.claimTranscodeJobForWorker('w1');

      // Local queue should not see the claimed job
      const pending = db.getPendingTranscodeJobs();
      expect(pending).toHaveLength(0);
    });
  });

  describe('Stale worker job detection', () => {
    it('detects stale worker jobs', () => {
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      // Create worker with old heartbeat
      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.claimTranscodeJobForWorker('w1');

      // Manually set heartbeat to the past
      const pastTime = Date.now() - 5 * 60 * 1000; // 5 minutes ago
      db['db'].prepare('UPDATE workers SET last_heartbeat = ? WHERE id = ?').run(pastTime, 'w1');

      const staleJobs = db.getStaleWorkerJobs(2 * 60 * 1000); // 2 min timeout
      expect(staleJobs).toHaveLength(1);
      expect(staleJobs[0].workerId).toBe('w1');
    });

    it('does not flag jobs with recent heartbeat', () => {
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.claimTranscodeJobForWorker('w1');

      const staleJobs = db.getStaleWorkerJobs(2 * 60 * 1000);
      expect(staleJobs).toHaveLength(0);
    });

    it('resets stale worker job to pending', () => {
      const user = db.createAdminUser({
        username: 'admin', passwordHash: 'h', email: 'a@t.com', isAdmin: true,
      });
      const job = db.createTranscodeJob({
        userId: user.id, ratingKey: '123', resolutionId: '720p',
        resolutionLabel: '720p', resolutionHeight: 720, maxBitrate: 4000,
        mediaTitle: 'Test', mediaType: 'movie', filename: 'test.mp4',
      });

      db.createWorker({ id: 'w1', name: 'worker-1' });
      db.claimTranscodeJobForWorker('w1');
      db.resetStaleWorkerJob(job.id);

      const updated = db.getTranscodeJob(job.id);
      expect(updated!.status).toBe('pending');
      expect(updated!.workerId).toBeFalsy();
      expect(updated!.assignedAt).toBeFalsy();
      expect(updated!.progress).toBe(0);
    });
  });
});
