import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DatabaseService } from '../../models/database';
import { createTestApp } from '../helpers/app-factory';
import { createAdminAndToken, createPlexUserAndToken } from '../helpers/auth-helpers';

// Mock fs for log file reading
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('combined.log')) {
          return (vi as any).__logFileExists ?? false;
        }
        return actual.existsSync(p);
      }),
      createReadStream: vi.fn().mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('combined.log')) {
          const { Readable } = require('stream');
          const logLines = (vi as any).__logFileContent ?? '';
          const stream = new Readable();
          stream.push(logLines);
          stream.push(null);
          return stream;
        }
        return actual.createReadStream(p);
      }),
      mkdirSync: actual.mkdirSync,
      readFileSync: actual.readFileSync,
    },
    existsSync: vi.fn().mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('combined.log')) {
        return (vi as any).__logFileExists ?? false;
      }
      return actual.existsSync(p);
    }),
    createReadStream: vi.fn().mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('combined.log')) {
        const { Readable } = require('stream');
        const logLines = (vi as any).__logFileContent ?? '';
        const stream = new Readable();
        stream.push(logLines);
        stream.push(null);
        return stream;
      }
      return actual.createReadStream(p);
    }),
  };
});

let app: Express;
let db: DatabaseService;

beforeEach(() => {
  ({ app, db } = createTestApp());
  vi.clearAllMocks();
  (vi as any).__logFileExists = false;
  (vi as any).__logFileContent = '';
});

describe('GET /api/logs', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/logs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const { token } = createPlexUserAndToken(db);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns empty logs when no log file exists', async () => {
    const { token } = await createAdminAndToken(db);
    (vi as any).__logFileExists = false;

    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns parsed logs from file', async () => {
    const { token } = await createAdminAndToken(db);
    (vi as any).__logFileExists = true;
    (vi as any).__logFileContent = [
      JSON.stringify({ timestamp: '2024-01-01 00:00:00', level: 'info', message: 'Server started' }),
      JSON.stringify({ timestamp: '2024-01-01 00:01:00', level: 'error', message: 'Something failed' }),
    ].join('\n') + '\n';

    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('filters by level', async () => {
    const { token } = await createAdminAndToken(db);
    (vi as any).__logFileExists = true;
    (vi as any).__logFileContent = [
      JSON.stringify({ timestamp: '2024-01-01 00:00:00', level: 'info', message: 'Server started' }),
      JSON.stringify({ timestamp: '2024-01-01 00:01:00', level: 'error', message: 'Something failed' }),
    ].join('\n') + '\n';

    const res = await request(app)
      .get('/api/logs?level=error')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].level).toBe('error');
  });

  it('filters by search text', async () => {
    const { token } = await createAdminAndToken(db);
    (vi as any).__logFileExists = true;
    (vi as any).__logFileContent = [
      JSON.stringify({ timestamp: '2024-01-01 00:00:00', level: 'info', message: 'Server started' }),
      JSON.stringify({ timestamp: '2024-01-01 00:01:00', level: 'error', message: 'Database error' }),
    ].join('\n') + '\n';

    const res = await request(app)
      .get('/api/logs?search=database')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].message).toContain('Database');
  });

  it('supports pagination', async () => {
    const { token } = await createAdminAndToken(db);
    (vi as any).__logFileExists = true;
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ timestamp: `2024-01-01 00:0${i}:00`, level: 'info', message: `Log entry ${i}` }));
    }
    (vi as any).__logFileContent = lines.join('\n') + '\n';

    const res = await request(app)
      .get('/api/logs?page=1&limit=3')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(3);
    expect(res.body.total).toBe(10);
    expect(res.body.totalPages).toBe(4);
  });
});
