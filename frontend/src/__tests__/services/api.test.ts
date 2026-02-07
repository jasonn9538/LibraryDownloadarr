import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock axios before importing api module
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

import { api } from '../../services/api';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ApiClient URL builders', () => {
  describe('getDownloadUrl', () => {
    it('builds download URL with token and encoded partKey', () => {
      (localStorage.getItem as any).mockReturnValue('test-token');
      const url = api.getDownloadUrl('100', '/library/parts/1/file.mkv');
      expect(url).toBe('/api/media/100/download?partKey=%2Flibrary%2Fparts%2F1%2Ffile.mkv&token=test-token');
    });

    it('handles null token', () => {
      (localStorage.getItem as any).mockReturnValue(null);
      const url = api.getDownloadUrl('100', '/part');
      expect(url).toContain('token=null');
    });

    it('encodes special characters in partKey', () => {
      (localStorage.getItem as any).mockReturnValue('tok');
      const url = api.getDownloadUrl('100', '/path with spaces/file (1).mkv');
      expect(url).toContain('partKey=%2Fpath%20with%20spaces%2Ffile%20(1).mkv');
    });
  });

  describe('getTranscodeDownloadUrl', () => {
    it('builds transcode download URL', () => {
      const url = api.getTranscodeDownloadUrl('100', '720p');
      expect(url).toBe('/api/media/100/download/transcode?resolution=720p');
    });

    it('encodes resolution ID', () => {
      const url = api.getTranscodeDownloadUrl('100', 'custom res');
      expect(url).toContain('resolution=custom%20res');
    });
  });

  describe('getTranscodeJobDownloadUrl', () => {
    it('builds job download URL', () => {
      const url = api.getTranscodeJobDownloadUrl('job-123');
      expect(url).toBe('/api/transcodes/job-123/download');
    });
  });

  describe('getSeasonDownloadUrl', () => {
    it('builds season download URL with token', () => {
      (localStorage.getItem as any).mockReturnValue('my-token');
      const url = api.getSeasonDownloadUrl('300');
      expect(url).toBe('/api/media/season/300/download?token=my-token');
    });
  });

  describe('getAlbumDownloadUrl', () => {
    it('builds album download URL with token', () => {
      (localStorage.getItem as any).mockReturnValue('my-token');
      const url = api.getAlbumDownloadUrl('400');
      expect(url).toBe('/api/media/album/400/download?token=my-token');
    });
  });

  describe('getThumbnailUrl', () => {
    it('builds thumbnail URL with encoded path and token', () => {
      (localStorage.getItem as any).mockReturnValue('my-token');
      const url = api.getThumbnailUrl('100', '/library/metadata/100/thumb/12345');
      expect(url).toContain('/api/media/thumb/100');
      expect(url).toContain('path=%2Flibrary%2Fmetadata%2F100%2Fthumb%2F12345');
      expect(url).toContain('token=my-token');
    });
  });
});
