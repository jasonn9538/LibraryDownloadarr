import { Router, Request } from 'express';
import bcrypt from 'bcrypt';
import { DatabaseService } from '../models/database';
import { plexService } from '../services/plexService';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware } from '../middleware/auth';
import net from 'net';

// Brute force protection constants
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Admin login can be disabled via environment variable for better security
// When disabled, only Plex OAuth is available
const ADMIN_LOGIN_ENABLED = process.env.ADMIN_LOGIN_ENABLED !== 'false';

/**
 * Check if an IP address is in a private/local network range.
 * Covers loopback, RFC 1918, link-local, and IPv4-mapped IPv6.
 */
function isPrivateIp(ip: string): boolean {
  // Handle IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.1)
  let normalizedIp = ip;
  if (normalizedIp.startsWith('::ffff:')) {
    normalizedIp = normalizedIp.slice(7);
  }

  // IPv6 loopback
  if (normalizedIp === '::1') return true;

  // IPv6 link-local (fe80::/10)
  if (normalizedIp.toLowerCase().startsWith('fe80:')) return true;

  // Check IPv4 ranges
  if (net.isIPv4(normalizedIp)) {
    const parts = normalizedIp.split('.').map(Number);
    // Loopback: 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Link-local: 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  return false;
}

/**
 * Check if the request originates from a local/private network.
 * Uses req.socket.remoteAddress (raw TCP address) which cannot be spoofed,
 * unlike X-Forwarded-For headers.
 */
function isLocalRequest(req: Request): boolean {
  const socketAddr = req.socket.remoteAddress;
  if (!socketAddr) return false;
  return isPrivateIp(socketAddr);
}

function getClientIp(req: Request): string {
  // Support for reverse proxies
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export const createAuthRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);

  // Clean up old failed login attempts periodically (every hour)
  setInterval(() => {
    db.cleanupOldFailedAttempts();
  }, 60 * 60 * 1000);

  // Check if initial setup is required
  router.get('/setup/required', (_req, res) => {
    const hasAdmin = db.hasAdminUser();
    return res.json({ setupRequired: !hasAdmin });
  });

  // Check if admin login is enabled (for frontend to show/hide login form)
  // Only report as enabled when the request comes from a local/private network
  router.get('/admin-login-enabled', (req, res) => {
    return res.json({ enabled: ADMIN_LOGIN_ENABLED && isLocalRequest(req) });
  });

  // Initial admin setup — only available from local network
  router.post('/setup', async (req, res) => {
    try {
      if (!isLocalRequest(req)) {
        logger.warn('Remote setup attempt blocked', { ip: req.socket.remoteAddress });
        return res.status(403).json({ error: 'Initial setup is only available from the local network' });
      }

      // SECURITY: Setup can be disabled if admin login is disabled and there's already an OAuth admin
      if (!ADMIN_LOGIN_ENABLED && db.hasAdminUser()) {
        return res.status(403).json({ error: 'Admin login is disabled' });
      }

      if (db.hasAdminUser()) {
        return res.status(400).json({ error: 'Setup already completed' });
      }

      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // SECURITY: Enforce strong password requirements
      if (password.length < 12) {
        return res.status(400).json({ error: 'Password must be at least 12 characters long' });
      }

      // Check for password complexity
      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      if (!hasUppercase || !hasLowercase || !hasNumber) {
        return res.status(400).json({
          error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
        });
      }

      // Hash password (using bcrypt cost factor 12 for better security)
      const passwordHash = await bcrypt.hash(password, 12);

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

  // Admin login — only available from local network
  router.post('/login', async (req, res) => {
    try {
      // SECURITY: Admin login can be disabled via environment variable
      if (!ADMIN_LOGIN_ENABLED) {
        logger.warn('Admin login attempt when disabled', { ip: getClientIp(req) });
        return res.status(403).json({ error: 'Admin login is disabled. Please use Plex authentication.' });
      }

      // SECURITY: Admin login only allowed from local/private network
      if (!isLocalRequest(req)) {
        logger.warn('Remote admin login attempt blocked', { ip: req.socket.remoteAddress });
        return res.status(403).json({ error: 'Admin login is only available from the local network' });
      }

      const ip = getClientIp(req);

      // Check if IP is blocked (using database for persistence)
      const blockStatus = db.isIpBlocked(ip);
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
        const result = db.recordFailedAttempt(ip, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS);
        logger.warn('Failed login attempt - user not found', { ip, username });
        // Log to audit trail
        db.logAuditEvent('LOGIN_FAILED', undefined, username, ip, { reason: 'user_not_found' });
        if (result.blocked) {
          return res.status(429).json({
            error: 'Too many failed login attempts. Try again in 15 minutes.'
          });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        const result = db.recordFailedAttempt(ip, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS);
        logger.warn('Failed login attempt - wrong password', { ip, username });
        // Log to audit trail
        db.logAuditEvent('LOGIN_FAILED', user.id, username, ip, { reason: 'invalid_password' });
        if (result.blocked) {
          return res.status(429).json({
            error: 'Too many failed login attempts. Try again in 15 minutes.'
          });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Successful login - clear failed attempts
      db.clearFailedAttempts(ip);

      db.updateAdminLastLogin(user.id);
      const session = db.createSession(user.id);

      // Log successful login to audit trail
      db.logAuditEvent('LOGIN_SUCCESS', user.id, user.username, ip, { method: 'password' });

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

  // Plex OAuth: Callback page that auto-closes after authentication
  // This is the forwardUrl that Plex redirects to after successful auth
  router.get('/plex/callback', (_req, res) => {
    // Send a page that notifies the parent window via postMessage and attempts to close.
    // Browsers block window.close() on tabs that navigated through cross-origin (app.plex.tv),
    // so postMessage lets the parent (same-origin opener) close the popup instead.
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LibraryDownloadarr - Authentication Complete</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      text-align: center;
    }
    .container { padding: 2rem; }
    h1 { color: #e87c03; margin-bottom: 1rem; }
    p { color: #9ca3af; }
    .close-btn {
      display: none;
      margin-top: 1.5rem;
      padding: 0.75rem 2rem;
      background: #e87c03;
      color: #fff;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
    }
    .close-btn:hover { background: #d06a00; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authentication Complete</h1>
    <p>This window will close automatically...</p>
    <button class="close-btn" id="closeBtn" onclick="window.close()">Close this window</button>
  </div>
  <script>
    // Notify the parent window that auth is complete
    if (window.opener) {
      try { window.opener.postMessage({ type: 'plex-auth-complete' }, '*'); } catch(e) {}
    }
    // Try to close the window
    window.close();
    setTimeout(function() { window.close(); }, 100);
    setTimeout(function() { window.close(); }, 500);
    // If still open after 1.5s, show manual close button
    setTimeout(function() {
      document.getElementById('closeBtn').style.display = 'inline-block';
      document.querySelector('p').textContent = 'You can close this window now.';
    }, 1500);
  </script>
</body>
</html>`);
  });

  // Plex OAuth: Generate PIN
  router.post('/plex/pin', async (req, res) => {
    try {
      const pin = await plexService.generatePin();

      // Build the callback URL for auto-closing the popup
      // Use the origin from the request or fall back to relative path
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const callbackUrl = host ? `${protocol}://${host}/api/auth/plex/callback` : '/api/auth/plex/callback';

      return res.json({
        id: pin.id,
        code: pin.code,
        url: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
          'librarydownloadarr'
        )}&code=${encodeURIComponent(pin.code)}&context[device][product]=${encodeURIComponent(
          'LibraryDownloadarr'
        )}&forwardUrl=${encodeURIComponent(callbackUrl)}`,
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

      // Log successful Plex login to audit trail
      db.logAuditEvent('LOGIN_SUCCESS', plexUser.id, plexUser.username, getClientIp(req), { method: 'plex_oauth' });

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

      // SECURITY: Enforce strong password requirements
      if (newPassword.length < 12) {
        return res.status(400).json({ error: 'New password must be at least 12 characters long' });
      }

      // Check for password complexity (at least one uppercase, one lowercase, one number)
      const hasUppercase = /[A-Z]/.test(newPassword);
      const hasLowercase = /[a-z]/.test(newPassword);
      const hasNumber = /[0-9]/.test(newPassword);
      if (!hasUppercase || !hasLowercase || !hasNumber) {
        return res.status(400).json({
          error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
        });
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

      // Hash new password (using bcrypt cost factor 12 for better security)
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      // Update password in database
      db.updateAdminPassword(user.id, newPasswordHash);

      // SECURITY: Invalidate all other sessions for this user
      // Keep the current session so user doesn't get logged out
      const currentToken = req.authSession?.token;
      db.deleteUserSessions(user.id, currentToken);

      // Log password change to audit trail
      db.logAuditEvent('PASSWORD_CHANGED', user.id, user.username, getClientIp(req));

      logger.info(`Password changed for admin user: ${user.username}`, {
        userId: user.id,
        ip: getClientIp(req)
      });

      return res.json({ message: 'Password changed successfully. All other sessions have been logged out.' });
    } catch (error) {
      logger.error('Password change error', { error });
      return res.status(500).json({ error: 'Password change failed' });
    }
  });

  return router;
};
