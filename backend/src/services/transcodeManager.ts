import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Directory for cached transcodes - configurable via environment variable
const CACHE_DIR = process.env.TRANSCODE_DIR || '/app/transcode';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface TranscodeJob {
  cacheKey: string;
  ratingKey: string;
  resolutionId: string;
  ffmpegProcess: ChildProcess | null;
  outputPath: string;
  progress: number; // 0-100
  totalDuration: number; // in seconds
  status: 'transcoding' | 'completed' | 'error';
  error?: string;
  subscribers: Set<Response>;
  createdAt: number;
  bytesWritten: number;
}

class TranscodeManager {
  private jobs: Map<string, TranscodeJob> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    // Check if transcode directory is configured
    if (!process.env.TRANSCODE_DIR) {
      logger.warn('TRANSCODE_DIR not configured, using default: /app/transcode');
    }

    // Ensure cache directory exists
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      this.initialized = true;
      logger.info('Transcode manager initialized', { cacheDir: CACHE_DIR });
    } catch (err) {
      logger.error('Failed to create transcode directory', {
        cacheDir: CACHE_DIR,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
      this.initialized = false;
      return;
    }

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupOldFiles(), 5 * 60 * 1000); // Every 5 minutes

    // Clean up on startup
    this.cleanupOldFiles();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCacheDir(): string {
    return CACHE_DIR;
  }

  getCacheKey(ratingKey: string, resolutionId: string): string {
    return `${ratingKey}-${resolutionId}`;
  }

  getJob(cacheKey: string): TranscodeJob | undefined {
    return this.jobs.get(cacheKey);
  }

  getProgress(cacheKey: string): { progress: number; status: string } | null {
    const job = this.jobs.get(cacheKey);
    if (!job) return null;
    return { progress: job.progress, status: job.status };
  }

  /**
   * Start or join a transcode job
   * Returns the job for the caller to subscribe to
   */
  async startOrJoinTranscode(
    ratingKey: string,
    resolutionId: string,
    resolutionHeight: number,
    maxBitrate: number,
    totalDuration: number, // in milliseconds from Plex
    inputStream: NodeJS.ReadableStream,
    _filename: string // Prefixed with _ to indicate intentionally unused
  ): Promise<TranscodeJob> {
    if (!this.initialized) {
      throw new Error('Transcode manager not initialized - check TRANSCODE_DIR configuration');
    }

    const cacheKey = this.getCacheKey(ratingKey, resolutionId);
    const existingJob = this.jobs.get(cacheKey);

    // If job exists and is completed, return it (cached file)
    if (existingJob && existingJob.status === 'completed') {
      logger.info('Serving cached transcode', { cacheKey });
      return existingJob;
    }

    // If job exists and is transcoding, return it (join existing)
    if (existingJob && existingJob.status === 'transcoding') {
      logger.info('Joining existing transcode', { cacheKey, subscribers: existingJob.subscribers.size + 1 });
      return existingJob;
    }

    // Start new transcode job
    const outputPath = path.join(CACHE_DIR, `${cacheKey}-${Date.now()}.mp4`);
    const durationSeconds = totalDuration / 1000;

    const job: TranscodeJob = {
      cacheKey,
      ratingKey,
      resolutionId,
      ffmpegProcess: null,
      outputPath,
      progress: 0,
      totalDuration: durationSeconds,
      status: 'transcoding',
      subscribers: new Set(),
      createdAt: Date.now(),
      bytesWritten: 0,
    };

    this.jobs.set(cacheKey, job);

    // Build ffmpeg arguments
    // Try to use hardware acceleration if available (Intel Quick Sync via VAAPI)
    // Falls back to fast software encoding if hardware isn't available
    const useHardwareAccel = fs.existsSync('/dev/dri/renderD128');

    let ffmpegArgs: string[];

    if (useHardwareAccel) {
      // Hardware-accelerated encoding using Intel Quick Sync (VAAPI)
      // This is MUCH faster than software encoding
      logger.info('Using hardware acceleration (VAAPI)', { cacheKey });
      ffmpegArgs = [
        '-hwaccel', 'vaapi',
        '-hwaccel_device', '/dev/dri/renderD128',
        '-hwaccel_output_format', 'vaapi',
        '-i', 'pipe:0',
        '-vf', `scale_vaapi=w=-2:h=${resolutionHeight}`,
        '-c:v', 'h264_vaapi',
        '-b:v', `${maxBitrate}k`,
        '-maxrate', `${maxBitrate}k`,
        '-bufsize', `${maxBitrate * 2}k`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        '-y',
        outputPath
      ];
    } else {
      // Software encoding - optimized for speed
      logger.info('Using software encoding (no hardware acceleration)', { cacheKey });
      ffmpegArgs = [
        '-i', 'pipe:0',
        '-vf', `scale=-2:${resolutionHeight}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'fastdecode',
        '-crf', '28',
        '-maxrate', `${maxBitrate}k`,
        '-bufsize', `${maxBitrate * 2}k`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        '-y',
        outputPath
      ];
    }

    logger.info('Starting transcode', {
      cacheKey,
      outputPath,
      resolution: resolutionHeight,
      duration: durationSeconds,
    });

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    job.ffmpegProcess = ffmpeg;

    // Parse ffmpeg stderr for progress
    ffmpeg.stderr.on('data', (data: Buffer) => {
      const output = data.toString();

      // Parse time= from ffmpeg output (format: time=HH:MM:SS.ms or time=SS.ms)
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && job.totalDuration > 0) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        job.progress = Math.min(99, Math.round((currentTime / job.totalDuration) * 100));
      }
    });

    // Track file size as it's written
    const checkFileSize = setInterval(() => {
      if (fs.existsSync(outputPath)) {
        try {
          const stats = fs.statSync(outputPath);
          job.bytesWritten = stats.size;
        } catch {
          // File might be in use
        }
      }
    }, 500);

    ffmpeg.on('error', (err) => {
      clearInterval(checkFileSize);
      logger.error('ffmpeg process error', { error: err.message, cacheKey });
      job.status = 'error';
      job.error = err.message;
      this.notifySubscribersOfError(job);
    });

    ffmpeg.on('close', (code) => {
      clearInterval(checkFileSize);
      if (code === 0) {
        job.status = 'completed';
        job.progress = 100;
        logger.info('Transcode completed', { cacheKey, outputPath });
        this.notifySubscribersOfCompletion();
      } else if (job.status !== 'error') {
        job.status = 'error';
        job.error = `ffmpeg exited with code ${code}`;
        logger.error('ffmpeg exited with error', { code, cacheKey });
        this.notifySubscribersOfError(job);
      }
    });

    // Pipe input stream to ffmpeg
    inputStream.pipe(ffmpeg.stdin);

    inputStream.on('error', (err) => {
      logger.error('Input stream error', { error: err.message, cacheKey });
      ffmpeg.kill('SIGTERM');
    });

    ffmpeg.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        logger.error('ffmpeg stdin error', { error: err.message, cacheKey });
      }
    });

    return job;
  }

  /**
   * Subscribe a response to a transcode job
   * Streams the output file as it's being written
   */
  subscribeToJob(job: TranscodeJob, res: Response, filename: string): void {
    job.subscribers.add(res);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Handle client disconnect
    res.on('close', () => {
      job.subscribers.delete(res);
      logger.info('Subscriber disconnected', {
        cacheKey: job.cacheKey,
        remainingSubscribers: job.subscribers.size
      });

      // If no subscribers left and still transcoding, consider killing
      if (job.subscribers.size === 0 && job.status === 'transcoding') {
        // Give a grace period in case someone reconnects
        setTimeout(() => {
          if (job.subscribers.size === 0 && job.status === 'transcoding') {
            logger.info('No subscribers, killing transcode', { cacheKey: job.cacheKey });
            this.cancelJob(job.cacheKey);
          }
        }, 10000); // 10 second grace period
      }
    });

    // If already completed, stream the cached file
    if (job.status === 'completed' && fs.existsSync(job.outputPath)) {
      const stats = fs.statSync(job.outputPath);
      res.setHeader('Content-Length', stats.size);
      const readStream = fs.createReadStream(job.outputPath);
      readStream.pipe(res);
      return;
    }

    // Stream the file as it's being written
    this.streamFileAsWritten(job, res);
  }

  /**
   * Stream a file to response as it's being written by ffmpeg
   */
  private streamFileAsWritten(job: TranscodeJob, res: Response): void {
    let bytesSent = 0;
    let checkInterval: NodeJS.Timeout;

    const sendMoreData = () => {
      if (!fs.existsSync(job.outputPath)) return;

      try {
        const stats = fs.statSync(job.outputPath);
        const fileSize = stats.size;

        if (fileSize > bytesSent) {
          const readStream = fs.createReadStream(job.outputPath, {
            start: bytesSent,
            end: fileSize - 1
          });

          readStream.on('data', (chunk: Buffer | string) => {
            if (!res.writableEnded) {
              res.write(chunk);
              bytesSent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
            }
          });

          readStream.on('end', () => {
            // Check if transcode is complete
            if (job.status === 'completed' && bytesSent >= fileSize) {
              clearInterval(checkInterval);
              res.end();
            }
          });

          readStream.on('error', (err) => {
            logger.error('Read stream error', { error: err.message });
          });
        } else if (job.status === 'completed') {
          // Transcode done and all data sent
          clearInterval(checkInterval);
          res.end();
        } else if (job.status === 'error') {
          clearInterval(checkInterval);
          if (!res.writableEnded) {
            res.end();
          }
        }
      } catch {
        // File might be in use, try again next interval
      }
    };

    // Check for new data every 500ms
    checkInterval = setInterval(sendMoreData, 500);
    sendMoreData(); // Initial check

    // Cleanup on response close
    res.on('close', () => {
      clearInterval(checkInterval);
    });
  }

  private notifySubscribersOfCompletion(): void {
    // Subscribers are already streaming, they'll get the rest of the file
  }

  private notifySubscribersOfError(job: TranscodeJob): void {
    for (const res of job.subscribers) {
      if (!res.writableEnded) {
        res.end();
      }
    }
    job.subscribers.clear();
  }

  /**
   * Cancel a transcode job
   */
  cancelJob(cacheKey: string): void {
    const job = this.jobs.get(cacheKey);
    if (!job) return;

    if (job.ffmpegProcess && !job.ffmpegProcess.killed) {
      job.ffmpegProcess.kill('SIGTERM');
    }

    // Clean up file
    if (fs.existsSync(job.outputPath)) {
      try {
        fs.unlinkSync(job.outputPath);
      } catch {
        logger.warn('Failed to delete transcode file', { path: job.outputPath });
      }
    }

    this.jobs.delete(cacheKey);
    logger.info('Transcode job cancelled', { cacheKey });
  }

  /**
   * Clean up old cached files (older than 1 hour)
   */
  private cleanupOldFiles(): void {
    if (!this.initialized) return;

    const now = Date.now();

    // Clean up completed jobs older than TTL
    for (const [key, job] of this.jobs) {
      if (job.status === 'completed' && (now - job.createdAt) > CACHE_TTL_MS) {
        logger.info('Cleaning up old transcode cache', { cacheKey: key, age: now - job.createdAt });

        if (fs.existsSync(job.outputPath)) {
          try {
            fs.unlinkSync(job.outputPath);
          } catch {
            logger.warn('Failed to delete old transcode file', { path: job.outputPath });
          }
        }

        this.jobs.delete(key);
      }
    }

    // Also clean up any orphaned files in the cache directory
    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        if ((now - stats.mtimeMs) > CACHE_TTL_MS) {
          fs.unlinkSync(filePath);
          logger.info('Cleaned up orphaned transcode file', { file });
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  /**
   * Shutdown - clean up all jobs
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const [, job] of this.jobs) {
      if (job.ffmpegProcess && !job.ffmpegProcess.killed) {
        job.ffmpegProcess.kill('SIGTERM');
      }
    }

    this.jobs.clear();
  }
}

// Singleton instance
export const transcodeManager = new TranscodeManager();
