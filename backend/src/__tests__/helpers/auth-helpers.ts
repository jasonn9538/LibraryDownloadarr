import bcrypt from 'bcrypt';
import { DatabaseService } from '../../models/database';

const STRONG_PASSWORD = 'TestPass123!xx';

/**
 * Create an admin user directly in the database (bypasses route-level bcrypt cost 12).
 * Uses bcrypt cost 4 for fast tests.
 */
export async function createAdminUser(
  db: DatabaseService,
  overrides?: { username?: string; email?: string; password?: string; isAdmin?: boolean }
) {
  const username = overrides?.username ?? 'admin';
  const password = overrides?.password ?? STRONG_PASSWORD;
  const email = overrides?.email ?? `${username}@localhost`;
  const isAdmin = overrides?.isAdmin ?? true;

  const passwordHash = await bcrypt.hash(password, 4);
  const user = db.createAdminUser({ username, passwordHash, email, isAdmin });
  return { user, password };
}

/**
 * Create an admin user and return a valid auth token.
 */
export async function createAdminAndToken(
  db: DatabaseService,
  overrides?: { username?: string; email?: string; password?: string; isAdmin?: boolean }
) {
  const { user, password } = await createAdminUser(db, overrides);
  const session = db.createSession(user.id);
  return { user, password, token: session.token };
}

/**
 * Create a Plex user directly in the database.
 */
export function createPlexUser(
  db: DatabaseService,
  overrides?: { username?: string; email?: string; plexToken?: string; plexId?: string }
) {
  const username = overrides?.username ?? 'plexuser';
  const email = overrides?.email ?? `${username}@plex.tv`;
  const plexToken = overrides?.plexToken ?? 'plex-test-token';
  const plexId = overrides?.plexId ?? `plex-${Date.now()}`;

  const user = db.createOrUpdatePlexUser({ username, email, plexToken, plexId });
  return user;
}

/**
 * Create a Plex user and return a valid auth token.
 */
export function createPlexUserAndToken(
  db: DatabaseService,
  overrides?: { username?: string; email?: string; plexToken?: string; plexId?: string }
) {
  const user = createPlexUser(db, overrides);
  const session = db.createSession(user.id);
  return { user, token: session.token };
}

export { STRONG_PASSWORD };
