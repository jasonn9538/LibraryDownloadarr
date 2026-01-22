import { Router, Request } from 'express';
import bcrypt from 'bcrypt';
import { DatabaseService } from '../models/database';
import { plexService } from '../services/plexService';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware } from '../middleware/auth';

// Brute force protection: track failed login attempts per IP
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface FailedAttempt {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const failedAttempts = new Map<string, FailedAttempt>();

// Clean up old entries periodically (every hour)
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of failedAttempts.entries()) {
    // Remove entries that are no longer locked and haven't had activity in 30 minutes
    if (!attempt.lockedUntil && now - attempt.firstAttempt > 30 * 60 * 1000) {
      failedAttempts.delete(ip);
    }
    // Remove entries whose lockout has expired
    if (attempt.lockedUntil && now > attempt.lockedUntil) {
      failedAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

function getClientIp(req: Request): string {
  // Support for reverse proxies
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isIpBlocked(ip: string): { blocked: boolean; remainingMs?: number } {
  const attempt = failedAttempts.get(ip);
  if (!attempt) return { blocked: false };

  if (attempt.lockedUntil) {
    const now = Date.now();
    if (now < attempt.lockedUntil) {
      return { blocked: true, remainingMs: attempt.lockedUntil - now };
    }
    // Lockout expired, reset
    failedAttempts.delete(ip);
    return { blocked: false };
  }

  return { blocked: false };
}

function recordFailedAttempt(ip: string): { blocked: boolean; attemptsRemaining: number } {
  const now = Date.now();
  let attempt = failedAttempts.get(ip);

  if (!attempt) {
    attempt = { count: 1, firstAttempt: now };
    failedAttempts.set(ip, attempt);
    return { blocked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS - 1 };
  }

  attempt.count++;

  if (attempt.count >= MAX_FAILED_ATTEMPTS) {
    attempt.lockedUntil = now + LOCKOUT_DURATION_MS;
    logger.warn('IP blocked due to too many failed login attempts', { ip, attempts: attempt.count });
    return { blocked: true, attemptsRemaining: 0 };
  }

  return { blocked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS - attempt.count };
}

function clearFailedAttempts(ip: string): void {
  failedAttempts.delete(ip);
}

export const createAuthRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);

  // Check if initial setup is required
  router.get('/setup/required', (_req, res) => {
    const hasAdmin = db.hasAdminUser();
    return res.json({ setupRequired: !hasAdmin });
  });

  // Initial admin setup
  router.post('/setup', async (req, res) => {
    try {
      if (db.hasAdminUser()) {
        return res.status(400).json({ error: 'Setup already completed' });
      }

      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create admin user (email is optional, use username@localhost as default)
      const adminUser = db.createAdminUser({
        username,
        passwordHash,
        email: `${username}@localhost`,
        isAdmin: true,
      });

      // Create session
      const session = db.createSession(adminUser.id);

      logger.info(`Initial admin setup completed for user: ${username}`);

      return res.json({
        message: 'Setup completed successfully',
        user: {
          id: adminUser.id,
          username: adminUser.username,
          email: adminUser.email,
          isAdmin: adminUser.isAdmin,
        },
        token: session.token,
      });
    } catch (error) {
      logger.error('Setup error', { error });
      return res.status(500).json({ error: 'Setup failed' });
    }
  });

  // Admin login
  router.post('/login', async (req, res) => {
    try {
      const ip = getClientIp(req);

      // Check if IP is blocked
      const blockStatus = isIpBlocked(ip);
      if (blockStatus.blocked) {
        const minutesRemaining = Math.ceil((blockStatus.remainingMs || 0) / 60000);
        logger.warn('Blocked login attempt from locked IP', { ip });
        return res.status(429).json({
          error: `Too many failed login attempts. Try again in ${minutesRemaining} minutes.`
        });
      }

      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const user = db.getAdminUserByUsername(username);
      if (!user) {
        const result = recordFailedAttempt(ip);
        logger.warn('Failed login attempt - user not found', { ip, username });
        if (result.blocked) {
          return res.status(429).json({
            error: 'Too many failed login attempts. Try again in 15 minutes.'
          });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        const result = recordFailedAttempt(ip);
        logger.warn('Failed login attempt - wrong password', { ip, username });
        if (result.blocked) {
          return res.status(429).json({
            error: 'Too many failed login attempts. Try again in 15 minutes.'
          });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Successful login - clear failed attempts
      clearFailedAttempts(ip);

      db.updateAdminLastLogin(user.id);
      const session = db.createSession(user.id);

      logger.info(`User logged in: ${username}`, { ip });

      return res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
        },
        token: session.token,
      });
    } catch (error) {
      logger.error('Login error', { error });
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  // Plex OAuth: Generate PIN
  router.post('/plex/pin', async (_req, res) => {
    try {
      const pin = await plexService.generatePin();
      return res.json({
        id: pin.id,
        code: pin.code,
        url: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
          'librarydownloadarr'
        )}&code=${encodeURIComponent(pin.code)}&context[device][product]=${encodeURIComponent(
          'LibraryDownloadarr'
        )}`,
      });
    } catch (error) {
      logger.error('Plex PIN generation error', { error });
      return res.status(500).json({ error: 'Failed to generate Plex PIN' });
    }
  });

  // Plex OAuth: Check PIN and authenticate
  router.post('/plex/authenticate', async (req, res) => {
    try {
      const { pinId } = req.body;

      if (!pinId) {
        return res.status(400).json({ error: 'PIN ID is required' });
      }

      logger.debug('Checking Plex PIN', { pinId });

      const authResponse = await plexService.checkPin(pinId);
      if (!authResponse) {
        return res.status(400).json({ error: 'PIN not yet authorized' });
      }

      logger.debug('Plex PIN authorized', { username: authResponse.user.username });

      // SECURITY: Validate user has access to admin's configured Plex server
      const adminServerUrl = db.getSetting('plex_url') || '';
      const adminMachineId = db.getSetting('plex_machine_id') || '';

      if (!adminServerUrl) {
        logger.error('Admin Plex server not configured');
        return res.status(500).json({ error: 'Plex server not configured. Please contact administrator.' });
      }

      if (!adminMachineId) {
        logger.error('Admin Plex machine ID not configured');
        return res.status(500).json({ error: 'Plex server machine ID not configured. Please contact administrator.' });
      }

      // Get user's accessible servers and validate they have access to admin's server
      let userToken: string;
      try {
        const userServers = await plexService.getUserServers(authResponse.authToken);
        const connection = plexService.findBestServerConnection(userServers, adminMachineId);

        if (!connection.serverUrl) {
          logger.warn('User does not have access to admin Plex server', {
            username: authResponse.user.username,
            adminMachineId,
            userServersCount: userServers.length
          });
          return res.status(403).json({
            error: 'Access denied. You do not have access to this Plex server.'
          });
        }

        // For shared servers, use the server's accessToken; for owned servers, use the user's auth token
        userToken = connection.accessToken || authResponse.authToken;

        logger.debug('User validated for admin server', {
          username: authResponse.user.username,
          hasAccessToken: !!connection.accessToken,
          isSharedServer: !!connection.accessToken
        });
      } catch (error) {
        logger.error('Failed to validate user server access', { error });
        return res.status(500).json({ error: 'Failed to validate server access' });
      }

      // Create or update plex user (no serverUrl stored - always use admin's)
      const plexUser = db.createOrUpdatePlexUser({
        username: authResponse.user.username,
        email: authResponse.user.email,
        plexToken: userToken,
        plexId: authResponse.user.uuid,
      });

      // Create session
      const session = db.createSession(plexUser.id);

      logger.info(`Plex user authenticated: ${plexUser.username}`);

      return res.json({
        user: {
          id: plexUser.id,
          username: plexUser.username,
          email: plexUser.email,
          isAdmin: plexUser.isAdmin,
        },
        token: session.token,
      });
    } catch (error: any) {
      logger.error('Plex authentication error', {
        error: error.message,
        stack: error.stack,
        pinId: req.body.pinId
      });
      return res.status(500).json({ error: 'Plex authentication failed' });
    }
  });

  // Get current user
  router.get('/me', authMiddleware, (req: AuthRequest, res) => {
    return res.json({ user: req.user });
  });

  // Logout
  router.post('/logout', authMiddleware, (req: AuthRequest, res) => {
    try {
      if (req.authSession?.token) {
        db.deleteSession(req.authSession.token);
      }
      return res.json({ message: 'Logged out successfully' });
    } catch (error) {
      logger.error('Logout error', { error });
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  // Change password (admin users only)
  router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }

      // Only admin users (those with password_hash) can change passwords
      // Plex users authenticate via OAuth and don't have passwords
      const user = db.getAdminUserById(req.user!.id);
      if (!user) {
        return res.status(400).json({ error: 'Password change is only available for admin accounts' });
      }

      // Verify current password
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password in database
      db.updateAdminPassword(user.id, newPasswordHash);

      logger.info(`Password changed for admin user: ${user.username}`);

      return res.json({ message: 'Password changed successfully' });
    } catch (error) {
      logger.error('Password change error', { error });
      return res.status(500).json({ error: 'Password change failed' });
    }
  });

  return router;
};
