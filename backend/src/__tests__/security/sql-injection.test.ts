import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseService } from '../../models/database';

let db: DatabaseService;

beforeEach(() => {
  db = new DatabaseService(':memory:');
});

describe('SQL injection prevention via parameterized queries', () => {
  const sqlPayloads = [
    "'; DROP TABLE admin_users; --",
    "' OR '1'='1",
    "admin'--",
    "1; DELETE FROM sessions",
    "' UNION SELECT * FROM admin_users --",
    "Robert'); DROP TABLE admin_users;--",
  ];

  for (const payload of sqlPayloads) {
    it(`getAdminUserByUsername safely handles: "${payload}"`, () => {
      const result = db.getAdminUserByUsername(payload);
      expect(result).toBeFalsy();
    });

    it(`getSetting safely handles: "${payload}"`, () => {
      const result = db.getSetting(payload);
      expect(result).toBeFalsy();
    });

    it(`getSessionByToken safely handles: "${payload}"`, () => {
      const result = db.getSessionByToken(payload);
      expect(result).toBeFalsy();
    });
  }

  it('stores and retrieves special characters in usernames without corruption', () => {
    const weirdUsername = "user'; DROP TABLE admin_users; --";
    const user = db.createAdminUser({
      username: weirdUsername,
      passwordHash: '$2b$04$hash',
      email: 'test@test.com',
      isAdmin: true,
    });
    const retrieved = db.getAdminUserByUsername(weirdUsername);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.username).toBe(weirdUsername);
    expect(user.id).toBeTruthy();
  });

  it('setSetting with SQL injection payload stores literally', () => {
    const key = 'test_key';
    const maliciousValue = "value'; DROP TABLE settings; --";
    db.setSetting(key, maliciousValue);
    const result = db.getSetting(key);
    expect(result).toBe(maliciousValue);
  });

  it('tables remain intact after all injection attempts', () => {
    for (const payload of sqlPayloads) {
      db.getAdminUserByUsername(payload);
      db.getSetting(payload);
      db.getSessionByToken(payload);
    }
    // Verify tables still work
    expect(db.hasAdminUser()).toBe(false);
    const user = db.createAdminUser({
      username: 'test',
      passwordHash: '$2b$04$hash',
      email: 'test@test.com',
      isAdmin: true,
    });
    expect(user.username).toBe('test');
    expect(db.hasAdminUser()).toBe(true);
  });

  it('logDownload safely handles injection in media title', () => {
    const user = db.createAdminUser({
      username: 'admin',
      passwordHash: '$2b$04$hash',
      email: 'admin@test.com',
      isAdmin: true,
    });
    const maliciousTitle = "Movie'; DROP TABLE download_logs; --";
    db.logDownload(user.id, maliciousTitle, '100', 1000);
    const history = db.getDownloadHistory(user.id);
    expect(history).toHaveLength(1);
    expect(history[0].media_title).toBe(maliciousTitle);
  });

  it('worker name with injection payload stores literally', () => {
    const maliciousName = "worker'; DROP TABLE workers; --";
    const worker = db.createWorker({ id: 'w1', name: maliciousName });
    expect(worker.name).toBe(maliciousName);
    const retrieved = db.getWorker('w1');
    expect(retrieved?.name).toBe(maliciousName);
  });
});
