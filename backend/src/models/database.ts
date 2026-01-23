import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface User {
  id: string;
  username: string;
  email: string;
  plexToken?: string;
  plexId?: string;
  serverUrl?: string;
  isAdmin: boolean;
  createdAt: number;
  lastLogin?: number;
}

export interface AdminUser {
  id: string;
  username: string;
  passwordHash: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
  lastLogin?: number;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
}

export interface Settings {
  key: string;
  value: string;
  updatedAt: number;
}

export type TranscodeJobStatus = 'pending' | 'transcoding' | 'completed' | 'error' | 'cancelled';

export interface TranscodeJob {
  id: string;
  userId: string;
  ratingKey: string;
  resolutionId: string;
  resolutionLabel?: string;
  resolutionHeight?: number;
  maxBitrate?: number;
  mediaTitle: string;
  mediaType?: string;
  filename: string;
  status: TranscodeJobStatus;
  progress: number;
  outputPath?: string;
  fileSize?: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;
  // Joined fields
  username?: string;
}

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    // Use DELETE mode instead of WAL for Docker compatibility
    // WAL requires shared memory files that may not work with bind mounts
    this.db.pragma('journal_mode = DELETE');
    this.initializeTables();
    logger.info(`Database initialized at ${dbPath}`);
  }

  private initializeTables(): void {
    // Admin users table (local authentication)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        is_admin INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_login INTEGER
      )
    `);

    // Plex users table (OAuth authenticated users)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plex_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT,
        plex_token TEXT,
        plex_id TEXT UNIQUE,
        server_url TEXT,
        is_admin INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_login INTEGER
      )
    `);

    // Migration: Add server_url column if it doesn't exist
    const hasServerUrl = this.db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('plex_users') WHERE name='server_url'
    `).get() as { count: number };

    if (hasServerUrl.count === 0) {
      logger.info('Adding server_url column to plex_users table');
      this.db.exec('ALTER TABLE plex_users ADD COLUMN server_url TEXT');
    }

    // Migrate sessions table if it has the old FOREIGN KEY constraint
    // Check if sessions table exists with FOREIGN KEY
    const hasOldSchema = this.db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='sessions' AND sql LIKE '%FOREIGN KEY%'
    `).get();

    if (hasOldSchema) {
      logger.info('Migrating sessions table to remove FOREIGN KEY constraint');
      // Drop old table and recreate without constraint
      this.db.exec('DROP TABLE IF EXISTS sessions');
    }

    // Sessions table (no FOREIGN KEY since we have both admin_users and plex_users)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Download logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS download_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        media_title TEXT NOT NULL,
        media_key TEXT NOT NULL,
        file_size INTEGER,
        downloaded_at INTEGER NOT NULL
      )
    `);

    // Transcode jobs table - persistent transcode queue
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcode_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        rating_key TEXT NOT NULL,
        resolution_id TEXT NOT NULL,
        resolution_label TEXT,
        resolution_height INTEGER,
        max_bitrate INTEGER,
        media_title TEXT NOT NULL,
        media_type TEXT,
        filename TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        output_path TEXT,
        file_size INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        expires_at INTEGER
      )
    `);

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcode_jobs_user_id ON transcode_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_transcode_jobs_status ON transcode_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_transcode_jobs_rating_key_resolution ON transcode_jobs(rating_key, resolution_id);
    `);

    // Failed login attempts table (for persistent brute force protection)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS failed_login_attempts (
        ip TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        first_attempt INTEGER NOT NULL,
        locked_until INTEGER
      )
    `);

    // Audit log table (for security-sensitive actions)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        ip TEXT,
        details TEXT
      )
    `);

    // Create index for audit log
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    `);

    logger.info('Database tables initialized');
  }

  // Admin user operations
  createAdminUser(user: Omit<AdminUser, 'id' | 'createdAt'>): AdminUser {
    const id = this.generateId();
    const createdAt = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO admin_users (id, username, password_hash, email, is_admin, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, user.username, user.passwordHash, user.email, user.isAdmin ? 1 : 0, createdAt);

    return { ...user, id, createdAt };
  }

  getAdminUserByUsername(username: string): AdminUser | undefined {
    const stmt = this.db.prepare('SELECT * FROM admin_users WHERE username = ?');
    const row = stmt.get(username) as any;
    return row ? this.mapAdminUser(row) : undefined;
  }

  getAdminUserById(id: string): AdminUser | undefined {
    const stmt = this.db.prepare('SELECT * FROM admin_users WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapAdminUser(row) : undefined;
  }

  hasAdminUser(): boolean {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM admin_users WHERE is_admin = 1');
    const result = stmt.get() as { count: number };
    return result.count > 0;
  }

  updateAdminLastLogin(id: string): void {
    const stmt = this.db.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?');
    stmt.run(Date.now(), id);
  }

  updateAdminPassword(id: string, passwordHash: string): void {
    const stmt = this.db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
    stmt.run(passwordHash, id);
  }

  // Plex user operations
  createOrUpdatePlexUser(plexUser: Omit<User, 'id' | 'createdAt' | 'isAdmin'>): User {
    // First check by plex_id
    let existing = this.getPlexUserByPlexId(plexUser.plexId!);

    // If not found by plex_id, check by username (handles managed users with different plex_ids)
    if (!existing) {
      existing = this.getPlexUserByUsername(plexUser.username);
    }

    if (existing) {
      // SECURITY: No longer store serverUrl - always use admin's configured server
      // Update by id to handle both plex_id match and username match cases
      const stmt = this.db.prepare(`
        UPDATE plex_users
        SET username = ?, email = ?, plex_token = ?, plex_id = ?, server_url = NULL, last_login = ?
        WHERE id = ?
      `);
      stmt.run(plexUser.username, plexUser.email, plexUser.plexToken, plexUser.plexId, Date.now(), existing.id);
      return { ...existing, ...plexUser, serverUrl: undefined, lastLogin: Date.now() };
    }

    const id = this.generateId();
    const createdAt = Date.now();
    // SECURITY: No longer store serverUrl - always use admin's configured server
    const stmt = this.db.prepare(`
      INSERT INTO plex_users (id, username, email, plex_token, plex_id, server_url, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    stmt.run(id, plexUser.username, plexUser.email, plexUser.plexToken, plexUser.plexId, createdAt, createdAt);

    return { id, ...plexUser, isAdmin: false, createdAt, lastLogin: createdAt };
  }

  getPlexUserByPlexId(plexId: string): User | undefined {
    const stmt = this.db.prepare('SELECT * FROM plex_users WHERE plex_id = ?');
    const row = stmt.get(plexId) as any;
    return row ? this.mapPlexUser(row) : undefined;
  }

  getPlexUserByUsername(username: string): User | undefined {
    const stmt = this.db.prepare('SELECT * FROM plex_users WHERE username = ?');
    const row = stmt.get(username) as any;
    return row ? this.mapPlexUser(row) : undefined;
  }

  getPlexUserById(id: string): User | undefined {
    const stmt = this.db.prepare('SELECT * FROM plex_users WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapPlexUser(row) : undefined;
  }

  // Session operations
  createSession(userId: string, expiresIn: number = 24 * 60 * 60 * 1000): Session {
    const id = this.generateId();
    const token = this.generateToken();
    const createdAt = Date.now();
    const expiresAt = createdAt + expiresIn;

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, userId, token, expiresAt, createdAt);

    return { id, userId, token, expiresAt, createdAt };
  }

  getSessionByToken(token: string): Session | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?');
    const row = stmt.get(token, Date.now()) as any;
    return row ? this.mapSession(row) : undefined;
  }

  deleteSession(token: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE token = ?');
    stmt.run(token);
  }

  cleanupExpiredSessions(): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    const result = stmt.run(Date.now());
    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} expired sessions`);
    }
  }

  // Delete all sessions for a user (used on password change for security)
  deleteUserSessions(userId: string, exceptToken?: string): number {
    let stmt;
    let result;
    if (exceptToken) {
      stmt = this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?');
      result = stmt.run(userId, exceptToken);
    } else {
      stmt = this.db.prepare('DELETE FROM sessions WHERE user_id = ?');
      result = stmt.run(userId);
    }
    if (result.changes > 0) {
      logger.info(`Invalidated ${result.changes} sessions for user`, { userId });
    }
    return result.changes;
  }

  // Settings operations
  getSetting(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `);
    const now = Date.now();
    stmt.run(key, value, now, value, now);
  }

  // Download logs
  logDownload(userId: string, mediaTitle: string, mediaKey: string, fileSize?: number): void {
    const id = this.generateId();
    const stmt = this.db.prepare(`
      INSERT INTO download_logs (id, user_id, media_title, media_key, file_size, downloaded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, userId, mediaTitle, mediaKey, fileSize, Date.now());
  }

  getDownloadHistory(userId: string, limit: number = 50): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM download_logs
      WHERE user_id = ?
      ORDER BY downloaded_at DESC
      LIMIT ?
    `);
    return stmt.all(userId, limit) as any[];
  }

  getAllDownloadHistory(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT dl.*,
             COALESCE(au.username, pu.username) as username
      FROM download_logs dl
      LEFT JOIN admin_users au ON dl.user_id = au.id
      LEFT JOIN plex_users pu ON dl.user_id = pu.id
      ORDER BY dl.downloaded_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  getDownloadStats(userId?: string): any {
    let query = 'SELECT COUNT(*) as count, SUM(file_size) as total_size FROM download_logs';
    const params: any[] = [];

    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }

    const stmt = this.db.prepare(query);
    return stmt.get(...params);
  }

  // Transcode job operations
  createTranscodeJob(job: Omit<TranscodeJob, 'id' | 'createdAt' | 'progress' | 'status'>): TranscodeJob {
    const id = this.generateId();
    const createdAt = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO transcode_jobs (
        id, user_id, rating_key, resolution_id, resolution_label, resolution_height,
        max_bitrate, media_title, media_type, filename, status, progress, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `);

    stmt.run(
      id, job.userId, job.ratingKey, job.resolutionId, job.resolutionLabel,
      job.resolutionHeight, job.maxBitrate, job.mediaTitle, job.mediaType,
      job.filename, createdAt
    );

    return {
      ...job,
      id,
      status: 'pending',
      progress: 0,
      createdAt,
    };
  }

  getTranscodeJob(id: string): TranscodeJob | undefined {
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.id = ?
    `);
    const row = stmt.get(id) as any;
    return row ? this.mapTranscodeJob(row) : undefined;
  }

  getTranscodeJobByCacheKey(ratingKey: string, resolutionId: string): TranscodeJob | undefined {
    // Get most recent job for this cache key that's not cancelled/error
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.rating_key = ? AND tj.resolution_id = ?
        AND tj.status IN ('pending', 'transcoding', 'completed')
        AND (tj.expires_at IS NULL OR tj.expires_at > ?)
      ORDER BY tj.created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(ratingKey, resolutionId, Date.now()) as any;
    return row ? this.mapTranscodeJob(row) : undefined;
  }

  getUserTranscodeJobs(userId: string): TranscodeJob[] {
    // First, get the username for this user (handles both admin and plex users)
    const userQuery = this.db.prepare(`
      SELECT username FROM admin_users WHERE id = ?
      UNION
      SELECT username FROM plex_users WHERE id = ?
    `);
    const userResult = userQuery.get(userId, userId) as { username: string } | undefined;
    const username = userResult?.username;

    // Get transcodes for this user OR any user with the same username
    // This handles cases where the same person logs in with different Plex managed users
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE (tj.user_id = ? OR COALESCE(au.username, pu.username) = ?)
        AND (tj.expires_at IS NULL OR tj.expires_at > ? OR tj.status NOT IN ('completed', 'error', 'cancelled'))
      ORDER BY tj.created_at DESC
    `);
    const rows = stmt.all(userId, username || '', Date.now()) as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  getAllAvailableTranscodes(): TranscodeJob[] {
    // Get all completed transcodes that haven't expired (for the "all available" toggle)
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.status = 'completed'
        AND (tj.expires_at IS NULL OR tj.expires_at > ?)
      ORDER BY tj.created_at DESC
    `);
    const rows = stmt.all(Date.now()) as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  getAllTranscodes(): TranscodeJob[] {
    // Get all transcodes (pending, transcoding, completed) that haven't expired
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.status IN ('pending', 'transcoding', 'completed')
        AND (tj.expires_at IS NULL OR tj.expires_at > ? OR tj.status NOT IN ('completed'))
      ORDER BY
        CASE tj.status
          WHEN 'transcoding' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'completed' THEN 3
        END,
        tj.created_at DESC
    `);
    const rows = stmt.all(Date.now()) as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  getAvailableTranscodesForMedia(ratingKey: string): TranscodeJob[] {
    // Get all available transcodes (pending, transcoding, completed) for a specific media item
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.rating_key = ?
        AND tj.status IN ('pending', 'transcoding', 'completed')
        AND (tj.expires_at IS NULL OR tj.expires_at > ? OR tj.status NOT IN ('completed'))
      ORDER BY tj.created_at DESC
    `);
    const rows = stmt.all(ratingKey, Date.now()) as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  getPendingTranscodeJobs(limit: number = 10): TranscodeJob[] {
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.status = 'pending'
      ORDER BY tj.created_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  getActiveTranscodeJobs(): TranscodeJob[] {
    const stmt = this.db.prepare(`
      SELECT tj.*,
             COALESCE(au.username, pu.username) as username
      FROM transcode_jobs tj
      LEFT JOIN admin_users au ON tj.user_id = au.id
      LEFT JOIN plex_users pu ON tj.user_id = pu.id
      WHERE tj.status = 'transcoding'
      ORDER BY tj.started_at ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => this.mapTranscodeJob(row));
  }

  updateTranscodeJobStatus(id: string, status: TranscodeJobStatus, updates?: Partial<TranscodeJob>): void {
    let query = 'UPDATE transcode_jobs SET status = ?';
    const params: any[] = [status];

    if (updates?.progress !== undefined) {
      query += ', progress = ?';
      params.push(updates.progress);
    }
    if (updates?.outputPath !== undefined) {
      query += ', output_path = ?';
      params.push(updates.outputPath);
    }
    if (updates?.fileSize !== undefined) {
      query += ', file_size = ?';
      params.push(updates.fileSize);
    }
    if (updates?.error !== undefined) {
      query += ', error = ?';
      params.push(updates.error);
    }
    if (updates?.startedAt !== undefined) {
      query += ', started_at = ?';
      params.push(updates.startedAt);
    }
    if (updates?.completedAt !== undefined) {
      query += ', completed_at = ?';
      params.push(updates.completedAt);
    }
    if (updates?.expiresAt !== undefined) {
      query += ', expires_at = ?';
      params.push(updates.expiresAt);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  updateTranscodeJobProgress(id: string, progress: number): void {
    const stmt = this.db.prepare('UPDATE transcode_jobs SET progress = ? WHERE id = ?');
    stmt.run(progress, id);
  }

  deleteTranscodeJob(id: string): void {
    const stmt = this.db.prepare('DELETE FROM transcode_jobs WHERE id = ?');
    stmt.run(id);
  }

  // Extend transcode job expiry (called on download to keep files that are being used)
  extendTranscodeJobExpiry(id: string, ttlMs: number = 7 * 24 * 60 * 60 * 1000): void {
    const newExpiry = Date.now() + ttlMs;
    const stmt = this.db.prepare('UPDATE transcode_jobs SET expires_at = ? WHERE id = ?');
    stmt.run(newExpiry, id);
    logger.debug('Extended transcode job expiry', { jobId: id, newExpiry: new Date(newExpiry).toISOString() });
  }

  cleanupExpiredTranscodeJobs(): TranscodeJob[] {
    // Get expired jobs that need file cleanup
    const stmt = this.db.prepare(`
      SELECT * FROM transcode_jobs
      WHERE status = 'completed' AND expires_at IS NOT NULL AND expires_at <= ?
    `);
    const expiredJobs = stmt.all(Date.now()) as any[];
    const jobs = expiredJobs.map((row: any) => this.mapTranscodeJob(row));

    // Delete them from database
    if (expiredJobs.length > 0) {
      const deleteStmt = this.db.prepare(`
        DELETE FROM transcode_jobs
        WHERE status = 'completed' AND expires_at IS NOT NULL AND expires_at <= ?
      `);
      const result = deleteStmt.run(Date.now());
      if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} expired transcode jobs from database`);
      }
    }

    return jobs;
  }

  getTranscodeJobCounts(userId?: string): { pending: number; transcoding: number; completed: number; error: number } {
    let query = `
      SELECT status, COUNT(*) as count
      FROM transcode_jobs
      WHERE (expires_at IS NULL OR expires_at > ? OR status NOT IN ('completed', 'error', 'cancelled'))
    `;
    const params: any[] = [Date.now()];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY status';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as { status: string; count: number }[];

    const counts = { pending: 0, transcoding: 0, completed: 0, error: 0 };
    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as keyof typeof counts] = row.count;
      }
    }
    return counts;
  }

  private mapTranscodeJob(row: any): TranscodeJob {
    return {
      id: row.id,
      userId: row.user_id,
      ratingKey: row.rating_key,
      resolutionId: row.resolution_id,
      resolutionLabel: row.resolution_label,
      resolutionHeight: row.resolution_height,
      maxBitrate: row.max_bitrate,
      mediaTitle: row.media_title,
      mediaType: row.media_type,
      filename: row.filename,
      status: row.status,
      progress: row.progress,
      outputPath: row.output_path,
      fileSize: row.file_size,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      username: row.username,
    };
  }

  // Utility methods
  // User management
  getAllUsers(): Array<{ id: string; username: string; email: string; isAdmin: boolean; type: 'admin' | 'plex'; createdAt: number; lastLogin?: number }> {
    const adminUsers = this.db.prepare('SELECT id, username, email, is_admin, created_at, last_login FROM admin_users').all() as any[];
    const plexUsers = this.db.prepare('SELECT id, username, email, is_admin, created_at, last_login FROM plex_users').all() as any[];

    const users = [
      ...adminUsers.map(row => ({
        id: row.id,
        username: row.username,
        email: row.email,
        isAdmin: row.is_admin === 1,
        type: 'admin' as const,
        createdAt: row.created_at,
        lastLogin: row.last_login,
      })),
      ...plexUsers.map(row => ({
        id: row.id,
        username: row.username,
        email: row.email || '',
        isAdmin: row.is_admin === 1,
        type: 'plex' as const,
        createdAt: row.created_at,
        lastLogin: row.last_login,
      })),
    ];

    // Sort by last login (most recent first), then by created_at
    return users.sort((a, b) => (b.lastLogin || b.createdAt) - (a.lastLogin || a.createdAt));
  }

  updateUserAdmin(userId: string, isAdmin: boolean): boolean {
    // Try admin_users first
    const adminResult = this.db.prepare('UPDATE admin_users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    if (adminResult.changes > 0) {
      logger.info('Updated admin status for admin user', { userId, isAdmin });
      return true;
    }

    // Try plex_users
    const plexResult = this.db.prepare('UPDATE plex_users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    if (plexResult.changes > 0) {
      logger.info('Updated admin status for plex user', { userId, isAdmin });
      return true;
    }

    return false;
  }

  deleteUser(userId: string): boolean {
    // Don't allow deleting the last admin
    const adminCount = (this.db.prepare('SELECT COUNT(*) as count FROM admin_users WHERE is_admin = 1').get() as { count: number }).count;
    const plexAdminCount = (this.db.prepare('SELECT COUNT(*) as count FROM plex_users WHERE is_admin = 1').get() as { count: number }).count;

    // Check if this is an admin user
    const adminUser = this.db.prepare('SELECT is_admin FROM admin_users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
    if (adminUser?.is_admin === 1 && adminCount <= 1 && plexAdminCount === 0) {
      logger.warn('Cannot delete the last admin user');
      return false;
    }

    // Try to delete from admin_users
    const adminResult = this.db.prepare('DELETE FROM admin_users WHERE id = ?').run(userId);
    if (adminResult.changes > 0) {
      // Also delete their sessions
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      logger.info('Deleted admin user', { userId });
      return true;
    }

    // Try to delete from plex_users
    const plexResult = this.db.prepare('DELETE FROM plex_users WHERE id = ?').run(userId);
    if (plexResult.changes > 0) {
      // Also delete their sessions
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      logger.info('Deleted plex user', { userId });
      return true;
    }

    return false;
  }

  private mapAdminUser(row: any): AdminUser {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      email: row.email,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      lastLogin: row.last_login,
    };
  }

  private mapPlexUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      plexToken: row.plex_token,
      plexId: row.plex_id,
      serverUrl: row.server_url,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      lastLogin: row.last_login,
    };
  }

  private mapSession(row: any): Session {
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private generateId(): string {
    // Use cryptographically secure random bytes for ID generation
    return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
  }

  private generateToken(): string {
    // Use cryptographically secure random bytes for session tokens (32 bytes = 256 bits)
    return crypto.randomBytes(32).toString('hex');
  }

  // Failed login attempts (brute force protection)
  getFailedAttempts(ip: string): { count: number; firstAttempt: number; lockedUntil?: number } | undefined {
    const stmt = this.db.prepare('SELECT count, first_attempt, locked_until FROM failed_login_attempts WHERE ip = ?');
    const row = stmt.get(ip) as { count: number; first_attempt: number; locked_until?: number } | undefined;
    if (!row) return undefined;
    return {
      count: row.count,
      firstAttempt: row.first_attempt,
      lockedUntil: row.locked_until || undefined,
    };
  }

  recordFailedAttempt(ip: string, maxAttempts: number, lockoutDurationMs: number): { blocked: boolean; attemptsRemaining: number } {
    const now = Date.now();
    const existing = this.getFailedAttempts(ip);

    if (!existing) {
      // First attempt
      const stmt = this.db.prepare(`
        INSERT INTO failed_login_attempts (ip, count, first_attempt)
        VALUES (?, 1, ?)
      `);
      stmt.run(ip, now);
      return { blocked: false, attemptsRemaining: maxAttempts - 1 };
    }

    const newCount = existing.count + 1;

    if (newCount >= maxAttempts) {
      // Lock the IP
      const lockedUntil = now + lockoutDurationMs;
      const stmt = this.db.prepare(`
        UPDATE failed_login_attempts SET count = ?, locked_until = ? WHERE ip = ?
      `);
      stmt.run(newCount, lockedUntil, ip);
      logger.warn('IP blocked due to too many failed login attempts', { ip, attempts: newCount });
      return { blocked: true, attemptsRemaining: 0 };
    }

    // Update count
    const stmt = this.db.prepare('UPDATE failed_login_attempts SET count = ? WHERE ip = ?');
    stmt.run(newCount, ip);
    return { blocked: false, attemptsRemaining: maxAttempts - newCount };
  }

  clearFailedAttempts(ip: string): void {
    const stmt = this.db.prepare('DELETE FROM failed_login_attempts WHERE ip = ?');
    stmt.run(ip);
  }

  isIpBlocked(ip: string): { blocked: boolean; remainingMs?: number } {
    const attempt = this.getFailedAttempts(ip);
    if (!attempt) return { blocked: false };

    if (attempt.lockedUntil) {
      const now = Date.now();
      if (now < attempt.lockedUntil) {
        return { blocked: true, remainingMs: attempt.lockedUntil - now };
      }
      // Lockout expired, clear it
      this.clearFailedAttempts(ip);
      return { blocked: false };
    }

    return { blocked: false };
  }

  cleanupOldFailedAttempts(): void {
    const now = Date.now();
    const thirtyMinutesAgo = now - 30 * 60 * 1000;

    // Remove entries that are not locked and haven't had activity in 30 minutes
    const stmt = this.db.prepare(`
      DELETE FROM failed_login_attempts
      WHERE (locked_until IS NULL AND first_attempt < ?)
         OR (locked_until IS NOT NULL AND locked_until < ?)
    `);
    const result = stmt.run(thirtyMinutesAgo, now);
    if (result.changes > 0) {
      logger.debug(`Cleaned up ${result.changes} old failed login attempts`);
    }
  }

  // Audit logging
  logAuditEvent(action: string, userId?: string, username?: string, ip?: string, details?: Record<string, any>): void {
    const id = this.generateId();
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, timestamp, action, user_id, username, ip, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, Date.now(), action, userId, username, ip, details ? JSON.stringify(details) : null);
  }

  getAuditLog(limit: number = 100, action?: string): Array<{
    id: string;
    timestamp: number;
    action: string;
    userId?: string;
    username?: string;
    ip?: string;
    details?: Record<string, any>;
  }> {
    let query = 'SELECT * FROM audit_log';
    const params: any[] = [];

    if (action) {
      query += ' WHERE action = ?';
      params.push(action);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      userId: row.user_id,
      username: row.username,
      ip: row.ip,
      details: row.details ? JSON.parse(row.details) : undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
