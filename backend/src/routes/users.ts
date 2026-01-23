import { Router } from 'express';
import { DatabaseService } from '../models/database';
import { logger } from '../utils/logger';
import { AuthRequest, createAuthMiddleware, createAdminMiddleware } from '../middleware/auth';

export const createUsersRouter = (db: DatabaseService) => {
  const router = Router();
  const authMiddleware = createAuthMiddleware(db);
  const adminMiddleware = createAdminMiddleware();

  // Get all users (admin only)
  router.get('/', authMiddleware, adminMiddleware, (_req: AuthRequest, res) => {
    try {
      const users = db.getAllUsers();
      return res.json({ users });
    } catch (error) {
      logger.error('Failed to get users', { error });
      return res.status(500).json({ error: 'Failed to get users' });
    }
  });

  // Update user admin status (admin only)
  router.patch('/:userId/admin', authMiddleware, adminMiddleware, (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { isAdmin } = req.body;

      // Validate input
      if (typeof isAdmin !== 'boolean') {
        return res.status(400).json({ error: 'isAdmin must be a boolean' });
      }

      // Prevent admin from removing their own admin status
      if (userId === req.user?.id && !isAdmin) {
        return res.status(400).json({ error: 'Cannot remove your own admin privileges' });
      }

      const success = db.updateUserAdmin(userId, isAdmin);
      if (!success) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info('User admin status updated', {
        userId,
        isAdmin,
        updatedBy: req.user?.username
      });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update user admin status', { error });
      return res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // Delete user (admin only)
  router.delete('/:userId', authMiddleware, adminMiddleware, (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;

      // Prevent admin from deleting themselves
      if (userId === req.user?.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      const success = db.deleteUser(userId);
      if (!success) {
        return res.status(400).json({ error: 'Cannot delete user. They may be the last admin or user not found.' });
      }

      logger.info('User deleted', {
        userId,
        deletedBy: req.user?.username
      });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete user', { error });
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  return router;
};
