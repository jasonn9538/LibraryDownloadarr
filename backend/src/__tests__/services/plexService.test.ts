import { describe, it, expect } from 'vitest';
import { getAvailableResolutions, RESOLUTION_PRESETS } from '../../services/plexService';

describe('RESOLUTION_PRESETS', () => {
  it('has 5 presets ordered by height descending', () => {
    expect(RESOLUTION_PRESETS).toHaveLength(5);
    expect(RESOLUTION_PRESETS[0].id).toBe('4k');
    expect(RESOLUTION_PRESETS[4].id).toBe('360p');
  });

  it('all presets have required fields', () => {
    for (const preset of RESOLUTION_PRESETS) {
      expect(preset.id).toBeDefined();
      expect(preset.label).toBeDefined();
      expect(preset.height).toBeGreaterThan(0);
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.maxVideoBitrate).toBeGreaterThan(0);
      expect(preset.videoCodec).toBe('h264');
      expect(preset.audioCodec).toBe('aac');
      expect(preset.container).toBe('mp4');
    }
  });
});

describe('getAvailableResolutions', () => {
  it('returns all resolutions for 4K source', () => {
    const available = getAvailableResolutions(2160);
    expect(available).toHaveLength(5);
  });

  it('returns 1080p and below for 1080p source', () => {
    const available = getAvailableResolutions(1080);
    expect(available).toHaveLength(4);
    expect(available.find(r => r.id === '4k')).toBeUndefined();
    expect(available.find(r => r.id === '1080p')).toBeDefined();
  });

  it('returns 720p and below for 720p source', () => {
    const available = getAvailableResolutions(720);
    expect(available).toHaveLength(3);
  });

  it('returns 480p and below for 480p source', () => {
    const available = getAvailableResolutions(480);
    expect(available).toHaveLength(2);
  });

  it('returns only 360p for 360p source', () => {
    const available = getAvailableResolutions(360);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe('360p');
  });

  it('returns empty for very low resolution', () => {
    const available = getAvailableResolutions(240);
    expect(available).toHaveLength(0);
  });

  it('returns correct resolutions for non-standard heights', () => {
    // 900p should include 720p, 480p, 360p
    const available = getAvailableResolutions(900);
    expect(available).toHaveLength(3);
    expect(available.map(r => r.id)).toEqual(['720p', '480p', '360p']);
  });
});
