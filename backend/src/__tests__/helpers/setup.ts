import { vi } from 'vitest';

// Silence winston logger during tests
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Set environment variables for tests
process.env.NODE_ENV = 'test';
process.env.ADMIN_LOGIN_ENABLED = 'true';
