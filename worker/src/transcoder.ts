import { spawn, ChildProcess, execSync } from 'child_process';
import { logger } from './logger';

// Text-based subtitle codecs that can be converted to mov_text (MP4 text subtitles)
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'ttml',
]);

/**
 * Probe input file with ffprobe to find text-based subtitle stream indices.
 * Bitmap subtitles (PGS, VOBSUB, DVB) cannot be converted to mov_text so they are skipped.
 */
function getTextSubtitleStreams(inputPath: string): number[] {
  try {
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams s "${inputPath.replace(/"/g, '\\"')}"`,
      { timeout: 30000 }
    ).toString();
    const parsed = JSON.parse(result);
    const indices: number[] = [];
    if (parsed.streams) {
      for (const stream of parsed.streams) {
        if (TEXT_SUBTITLE_CODECS.has(stream.codec_name)) {
          indices.push(stream.index);
        }
      }
    }
    if (indices.length > 0) {
      logger.info('Found text subtitle streams', { count: indices.length, indices });
    }
    return indices;
  } catch (err) {
    logger.warn('Failed to probe subtitle streams, skipping subtitles', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export interface TranscodeOptions {
  inputPath: string;
  outputPath: string;
  encoder: string;
  resolutionHeight: number;
  maxBitrate: number;
}

export interface TranscodeResult {
  success: boolean;
  error?: string;
}

export function transcode(
  options: TranscodeOptions,
  onProgress: (progress: number) => void,
  durationSeconds: number
): { process: ChildProcess; promise: Promise<TranscodeResult> } {
  const { inputPath, outputPath, encoder, resolutionHeight, maxBitrate } = options;

  // Probe for text subtitle streams before building ffmpeg args
  const subtitleStreams = getTextSubtitleStreams(inputPath);
  const ffmpegArgs = buildFfmpegArgs(encoder, inputPath, outputPath, resolutionHeight, maxBitrate, subtitleStreams);

  logger.info('Starting ffmpeg', { encoder, resolution: resolutionHeight, bitrate: maxBitrate });

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const promise = new Promise<TranscodeResult>((resolve) => {
    let stderrOutput = '';

    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();

      stderrOutput += output;
      if (stderrOutput.length > 2000) {
        stderrOutput = stderrOutput.slice(-2000);
      }

      // Parse time= from ffmpeg output
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && durationSeconds > 0) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const progress = Math.min(99, Math.round((currentTime / durationSeconds) * 100));
        onProgress(progress);
      }
    });

    ffmpegProcess.on('error', (err) => {
      logger.error('ffmpeg process error', { error: err.message });
      resolve({ success: false, error: err.message });
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        resolve({ success: true });
      } else {
        logger.error('ffmpeg failed', { exitCode: code, stderr: stderrOutput });
        resolve({ success: false, error: `ffmpeg exited with code ${code}: ${stderrOutput.slice(-500)}` });
      }
    });
  });

  return { process: ffmpegProcess, promise };
}

function buildFfmpegArgs(
  encoder: string,
  inputPath: string,
  outputPath: string,
  height: number,
  bitrate: number,
  subtitleStreams: number[] = [],
): string[] {
  // Subtitle mapping: map each text subtitle stream by absolute index
  const subtitleMapArgs: string[] = [];
  for (const idx of subtitleStreams) {
    subtitleMapArgs.push('-map', `0:${idx}`);
  }
  const subtitleCodecArgs = subtitleStreams.length > 0 ? ['-c:s', 'mov_text'] : [];

  const commonTailArgs = [
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '48000',
    ...subtitleCodecArgs,
    '-movflags', '+faststart',
    '-f', 'mp4',
    '-y',
    outputPath,
  ];

  if (encoder === 'h264_nvenc') {
    return [
      '-hwaccel', 'cuda',
      '-hwaccel_output_format', 'cuda',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      ...subtitleMapArgs,
      '-vf', `scale_cuda=-2:${height}`,
      '-c:v', 'h264_nvenc',
      '-preset', 'p4',
      '-tune', 'hq',
      '-profile:v', 'main',
      '-level', '4.0',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate * 2}k`,
      ...commonTailArgs,
    ];
  }

  if (encoder === 'h264_vaapi') {
    return [
      '-init_hw_device', 'vaapi=va:/dev/dri/renderD128',
      '-filter_hw_device', 'va',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      ...subtitleMapArgs,
      '-vf', `format=nv12,hwupload,scale_vaapi=w=-2:h=${height}`,
      '-c:v', 'h264_vaapi',
      '-profile:v', '77',
      '-level', '40',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate * 2}k`,
      ...commonTailArgs,
    ];
  }

  if (encoder === 'h264_qsv') {
    return [
      '-init_hw_device', 'qsv=qsv:hw',
      '-filter_hw_device', 'qsv',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      ...subtitleMapArgs,
      '-vf', `format=nv12,hwupload=extra_hw_frames=64,scale_qsv=w=-2:h=${height}`,
      '-c:v', 'h264_qsv',
      '-profile:v', 'main',
      '-level', '40',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate * 2}k`,
      ...commonTailArgs,
    ];
  }

  // Software encoding (libx264)
  return [
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    ...subtitleMapArgs,
    '-vf', `scale=-2:${height}`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-tune', 'film',
    '-profile:v', 'main',
    '-level', '4.0',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    ...commonTailArgs,
  ];
}
