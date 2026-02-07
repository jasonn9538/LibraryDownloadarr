import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { DatabaseService } from '../models/database';
import { logger } from '../utils/logger';

export interface WorkerAuthRequest extends Request {
  workerId?: string;
}

export const createWorkerAuthMiddleware = (db: DatabaseService) => {
  return (req: WorkerAuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing worker API key' });
      }

      const providedKey = authHeader.substring(7);
      const storedKey = db.getSetting('worker_api_key');

      if (!storedKey) {
        return res.status(401).json({ error: 'Worker API key not configured' });
      }

      // Timing-safe comparison to prevent timing attacks
      const providedBuf = Buffer.from(providedKey);
      const storedBuf = Buffer.from(storedKey);

      if (providedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(providedBuf, storedBuf)) {
        logger.warn('Invalid worker API key attempt', { ip: req.ip });
        return res.status(401).json({ error: 'Invalid worker API key' });
      }

      // Extract worker ID from header (set after registration)
      const workerId = req.headers['x-worker-id'] as string | undefined;
      if (workerId) {
        req.workerId = workerId;
      }

      return next();
    } catch (error) {
      logger.error('Worker authentication error', { error });
      return res.status(500).json({ error: 'Worker authentication failed' });
    }
  };
};
