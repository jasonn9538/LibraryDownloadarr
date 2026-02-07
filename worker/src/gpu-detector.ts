import { execSync } from 'child_process';
import { logger } from './logger';

export interface GpuCapabilities {
  gpu: string;
  encoders: string[];
  bestEncoder: string;
}

function testEncoder(name: string, command: string, timeoutMs: number = 15000): boolean {
  try {
    execSync(command, { timeout: timeoutMs, stdio: 'pipe' });
    return true;
  } catch (error) {
    logger.warn(`Encoder ${name} test failed`, {
      error: error instanceof Error ? error.message : String(error),
      command: command.substring(0, 100)
    });
    return false;
  }
}

export function detectGpu(): GpuCapabilities {
  const encoders: string[] = [];
  let gpu = 'None';

  // Test NVIDIA nvenc
  if (testEncoder('h264_nvenc',
    'ffmpeg -hide_banner -f lavfi -i nullsrc=s=256x256:d=1 -c:v h264_nvenc -f null - 2>&1'
  )) {
    encoders.push('h264_nvenc');
    gpu = 'NVIDIA';
    logger.info('NVIDIA nvenc encoding available');
  }

  // Test VAAPI (Intel/AMD)
  if (testEncoder('h264_vaapi',
    'ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD128 -f lavfi -i nullsrc=s=256x256:d=1 -vf "format=nv12,hwupload" -c:v h264_vaapi -f null - 2>&1'
  )) {
    encoders.push('h264_vaapi');
    if (gpu === 'None') gpu = 'VAAPI';
    logger.info('VAAPI encoding available');
  }

  // Test QSV (Intel Quick Sync)
  if (testEncoder('h264_qsv',
    'ffmpeg -hide_banner -init_hw_device qsv=qsv:hw -f lavfi -i nullsrc=s=256x256:d=1 -vf "format=nv12,hwupload=extra_hw_frames=64" -c:v h264_qsv -f null - 2>&1'
  )) {
    encoders.push('h264_qsv');
    if (gpu === 'None') gpu = 'QSV';
    logger.info('QSV encoding available');
  }

  // Software encoding always available
  encoders.push('libx264');

  const bestEncoder = encoders[0]; // First available is the best
  logger.info('GPU detection complete', { gpu, encoders, bestEncoder });

  return { gpu, encoders, bestEncoder };
}
