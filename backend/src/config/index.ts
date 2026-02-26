import path from 'path';

export const config = {
  server: {
    port: parseInt(process.env.PORT || '5069', 10),
  },
  plex: {
    clientIdentifier: 'librarydownloadarr',
    product: 'LibraryDownloadarr',
    version: '1.0.0',
    device: 'Server',
  },
  database: {
    path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'librarydownloadarr.db'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  cors: {
    // SECURITY: In production, CORS_ORIGIN must be set to your specific domain
    // Never use '*' with credentials in production
    origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173'),
    credentials: true,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per 15 min window
  },
  authRateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // auth endpoints: 30 requests per 15 min window
  },
};
