import { spawn, ChildProcess, execSync } from 'child_process';
import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import { logger } from '../utils/logger';
import { DatabaseService, TranscodeJob } from '../models/database';
import { plexService } from './plexService';

// Directory for cached transcodes - configurable via environment variable
const CACHE_DIR = process.env.TRANSCODE_DIR || '/app/transcode';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const DEFAULT_MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_TRANSCODES || '2', 10);
const STALE_WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (increased to allow slow uploads)
const HARDWARE_ENCODING = process.env.HARDWARE_ENCODING || 'auto'; // auto, vaapi, qsv, software

// SECURITY: Validate that a path is safe (no path traversal)
function isPathSafe(filePath: string): boolean {
  // Normalize the path to resolve any .. or . components
  const normalizedPath = path.normalize(filePath);

  // Check for path traversal attempts
  if (normalizedPath.includes('..')) {
    return false;
  }

  // Check for null bytes (used in path traversal attacks)
  if (filePath.includes('\0')) {
    return false;
  }

  return true;
}

// SECURITY: Validate that a local path is within allowed path mappings
function isPathWithinMappings(localPath: string, pathMappings: Array<{ plexPath: string; localPath: string }>): boolean {
  const normalizedLocalPath = path.normalize(localPath);

  for (const mapping of pathMappings) {
    const normalizedMappingPath = path.normalize(mapping.localPath);
    // Check if the local path starts with the mapping's local path
    if (normalizedLocalPath.startsWith(normalizedMappingPath)) {
      return true;
    }
  }

  return false;
}

// Text-based subtitle codecs that can be converted to mov_text (MP4 text subtitles)
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'ttml',
]);

/**
 * Probe input file with ffprobe to find text-based subtitle stream indices.
 * Bitmap subtitles (PGS, VOBSUB, DVB) cannot be converted to mov_text so they are skipped.
 * Returns absolute stream indices suitable for -map 0:{index}.
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

// HTTPS agent that bypasses SSL certificate validation for local Plex servers
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Hardware encoding detection
let detectedHardwareEncoder: string | null = null;
let hardwareDetectionDone = false;

async function detectHardwareEncoder(): Promise<string | null> {
  if (hardwareDetectionDone) return detectedHardwareEncoder;
  hardwareDetectionDone = true;

  if (HARDWARE_ENCODING === 'software') {
    logger.info('Hardware encoding disabled by configuration');
    return null;
  }

  // Check if /dev/dri exists (required for VAAPI/QSV)
  if (!fs.existsSync('/dev/dri')) {
    logger.info('No GPU devices found (/dev/dri not available), using software encoding');
    return null;
  }

  // If user specified a specific encoder, use it
  if (HARDWARE_ENCODING === 'vaapi') {
    detectedHardwareEncoder = 'vaapi';
    logger.info('Using VAAPI hardware encoding (configured)');
    return 'vaapi';
  }
  if (HARDWARE_ENCODING === 'qsv') {
    detectedHardwareEncoder = 'qsv';
    logger.info('Using QSV hardware encoding (configured)');
    return 'qsv';
  }

  // Auto-detect: try VAAPI first (works with both Intel and AMD)
  try {
    const { execSync } = require('child_process');
    // Test VAAPI
    execSync('ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD128 -f lavfi -i nullsrc=s=256x256:d=1 -vf "format=nv12,hwupload" -c:v h264_vaapi -f null - 2>&1', { timeout: 10000 });
    detectedHardwareEncoder = 'vaapi';
    logger.info('VAAPI hardware encoding available and working');
    return 'vaapi';
  } catch {
    logger.debug('VAAPI not available or not working');
  }

  // Try QSV (Intel Quick Sync)
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -hide_banner -init_hw_device qsv=qsv:hw -f lavfi -i nullsrc=s=256x256:d=1 -vf "format=nv12,hwupload=extra_hw_frames=64" -c:v h264_qsv -f null - 2>&1', { timeout: 10000 });
    detectedHardwareEncoder = 'qsv';
    logger.info('QSV hardware encoding available and working');
    return 'qsv';
  } catch {
    logger.debug('QSV not available or not working');
  }

  logger.info('No hardware encoding available, using software encoding');
  return null;
}

interface ActiveTranscode {
  jobId: string;
  ffmpegProcess: ChildProcess;
  subscribers: Set<Response>;
}

class TranscodeManager {
  private db: DatabaseService | null = null;
  private activeTranscodes: Map<string, ActiveTranscode> = new Map();
  private startingTranscodes: Set<string> = new Set(); // Track jobs being set up (before ffmpeg starts)
  private cleanupInterval: NodeJS.Timeout | null = null;
  private workerInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;
  private maxConcurrent: number = DEFAULT_MAX_CONCURRENT;

  initialize(db: DatabaseService): void {
    this.db = db;

    // Load max concurrent setting from database (env var as fallback)
    const savedMax = db.getSetting('max_concurrent_transcodes');
    if (savedMax) {
      const parsed = parseInt(savedMax, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
        this.maxConcurrent = parsed;
      }
    }

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
      logger.info('Transcode manager initialized', { cacheDir: CACHE_DIR, maxConcurrent: this.maxConcurrent });
    } catch (err) {
      logger.error('Failed to create transcode directory', {
        cacheDir: CACHE_DIR,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
      this.initialized = false;
      return;
    }

    // Mark any "transcoding" jobs as pending on startup (server restart recovery)
    this.recoverInterruptedJobs();

    // Start background worker to process queue
    this.workerInterval = setInterval(() => this.processQueue(), 5000); // Check every 5 seconds

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupExpiredFiles(), 5 * 60 * 1000); // Every 5 minutes

    // Initial cleanup
    this.cleanupExpiredFiles();

    // Start processing queue immediately
    this.processQueue();
  }

  private recoverInterruptedJobs(): void {
    if (!this.db) return;

    // Reset any "transcoding" jobs back to "pending" (server crashed mid-transcode)
    // Skip worker-assigned jobs — stale detection will handle those
    const activeJobs = this.db.getActiveTranscodeJobs();
    for (const job of activeJobs) {
      if (job.workerId) {
        logger.info('Skipping worker-assigned job during recovery (stale detection will handle)', {
          jobId: job.id,
          workerId: job.workerId,
        });
        continue;
      }

      logger.info('Recovering interrupted transcode job', { jobId: job.id, title: job.mediaTitle });
      this.db.updateTranscodeJobStatus(job.id, 'pending', { startedAt: undefined });

      // Clean up partial file if exists
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        try {
          fs.unlinkSync(job.outputPath);
        } catch {
          // Ignore
        }
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, Math.min(10, n));
    logger.info('Max concurrent transcodes updated', { maxConcurrent: this.maxConcurrent });
    // Process queue in case limit was raised and pending jobs can now start
    this.processQueue();
  }

  getCacheDir(): string {
    return CACHE_DIR;
  }

  getCacheKey(ratingKey: string, resolutionId: string): string {
    return `${ratingKey}-${resolutionId}`;
  }

  /**
   * Queue a new transcode job
   */
  queueTranscode(
    userId: string,
    ratingKey: string,
    resolutionId: string,
    resolutionLabel: string,
    resolutionHeight: number,
    maxBitrate: number,
    mediaTitle: string,
    mediaType: string,
    filename: string,
    episodeInfo?: { parentIndex?: number; index?: number; parentTitle?: string }
  ): TranscodeJob {
    if (!this.db) {
      throw new Error('Transcode manager not initialized');
    }

    // Check if there's already a job for this cache key
    const existingJob = this.db.getTranscodeJobByCacheKey(ratingKey, resolutionId);
    if (existingJob) {
      logger.info('Transcode job already exists', { jobId: existingJob.id, status: existingJob.status });
      return existingJob;
    }

    // Create new job
    const job = this.db.createTranscodeJob({
      userId,
      ratingKey,
      resolutionId,
      resolutionLabel,
      resolutionHeight,
      maxBitrate,
      mediaTitle,
      mediaType,
      filename,
      parentIndex: episodeInfo?.parentIndex,
      index: episodeInfo?.index,
      parentTitle: episodeInfo?.parentTitle,
    });

    logger.info('Transcode job queued', {
      jobId: job.id,
      title: mediaTitle,
      resolution: resolutionLabel,
      userId,
    });

    // Trigger queue processing
    this.processQueue();

    return job;
  }

  /**
   * Get a transcode job by ID
   */
  getJob(jobId: string): TranscodeJob | undefined {
    if (!this.db) return undefined;
    return this.db.getTranscodeJob(jobId);
  }

  /**
   * Get job by cache key (ratingKey + resolutionId)
   */
  getJobByCacheKey(ratingKey: string, resolutionId: string): TranscodeJob | undefined {
    if (!this.db) return undefined;
    return this.db.getTranscodeJobByCacheKey(ratingKey, resolutionId);
  }

  /**
   * Get all jobs for a user
   */
  getUserJobs(userId: string): TranscodeJob[] {
    if (!this.db) return [];
    return this.db.getUserTranscodeJobs(userId);
  }

  /**
   * Get all available completed transcodes (for "all available" toggle)
   */
  getAllAvailableTranscodes(): TranscodeJob[] {
    if (!this.db) return [];
    return this.db.getAllAvailableTranscodes();
  }

  /**
   * Get all transcodes (pending, transcoding, completed) for "show all" view
   */
  getAllTranscodes(): TranscodeJob[] {
    if (!this.db) return [];
    return this.db.getAllTranscodes();
  }

  /**
   * Get job counts for badge display
   */
  getJobCounts(userId?: string): { pending: number; transcoding: number; completed: number; error: number } {
    if (!this.db) return { pending: 0, transcoding: 0, completed: 0, error: 0 };
    return this.db.getTranscodeJobCounts(userId);
  }

  /**
   * Move a pending job up or down in the queue
   */
  moveJob(jobId: string, direction: 'up' | 'down'): boolean {
    if (!this.db) return false;

    const job = this.db.getTranscodeJob(jobId);
    if (!job || job.status !== 'pending') return false;

    const adjacent = this.db.getAdjacentPendingJob(jobId, direction);
    if (!adjacent) return false;

    this.db.swapQueuePosition(jobId, adjacent.id);
    logger.info('Queue position swapped', { jobId, adjacentId: adjacent.id, direction });
    return true;
  }

  /**
   * Cancel a transcode job
   */
  cancelJob(jobId: string): boolean {
    if (!this.db) return false;

    const job = this.db.getTranscodeJob(jobId);
    if (!job) return false;

    // If job is assigned to a worker, just mark as cancelled in DB
    // Worker will discover on next progress report (server returns 410)
    if (job.workerId && job.status === 'transcoding') {
      this.db.updateTranscodeJobStatus(jobId, 'cancelled');
      logger.info('Transcode job cancelled (worker will be notified)', { jobId, workerId: job.workerId });
      return true;
    }

    // Kill ffmpeg process if active (local transcode)
    const cacheKey = this.getCacheKey(job.ratingKey, job.resolutionId);
    const active = this.activeTranscodes.get(cacheKey);
    if (active && active.jobId === jobId) {
      if (!active.ffmpegProcess.killed) {
        active.ffmpegProcess.kill('SIGTERM');
      }
      // Notify subscribers
      for (const res of active.subscribers) {
        if (!res.writableEnded) {
          res.end();
        }
      }
      this.activeTranscodes.delete(cacheKey);
    }

    // Clean up file
    if (job.outputPath && fs.existsSync(job.outputPath)) {
      try {
        fs.unlinkSync(job.outputPath);
      } catch {
        logger.warn('Failed to delete transcode file on cancel', { path: job.outputPath });
      }
    }

    // Update status
    this.db.updateTranscodeJobStatus(jobId, 'cancelled');
    logger.info('Transcode job cancelled', { jobId });

    return true;
  }

  /**
   * Delete a completed job (removes file and database record)
   */
  deleteJob(jobId: string): boolean {
    if (!this.db) return false;

    const job = this.db.getTranscodeJob(jobId);
    if (!job) return false;

    // Can only delete completed, error, or cancelled jobs
    if (job.status === 'pending' || job.status === 'transcoding') {
      return this.cancelJob(jobId);
    }

    // Clean up file
    if (job.outputPath && fs.existsSync(job.outputPath)) {
      try {
        fs.unlinkSync(job.outputPath);
      } catch {
        logger.warn('Failed to delete transcode file', { path: job.outputPath });
      }
    }

    // Delete from database
    this.db.deleteTranscodeJob(jobId);
    logger.info('Transcode job deleted', { jobId });

    return true;
  }

  /**
   * Download a completed transcode
   */
  streamCompletedJob(jobId: string, res: Response): boolean {
    if (!this.db) return false;

    const job = this.db.getTranscodeJob(jobId);
    if (!job || job.status !== 'completed' || !job.outputPath) {
      return false;
    }

    if (!fs.existsSync(job.outputPath)) {
      logger.error('Transcode file missing', { jobId, path: job.outputPath });
      return false;
    }

    const stats = fs.statSync(job.outputPath);
    // Use RFC 5987 encoding for non-ASCII filenames
    const asciiFallback = job.filename.replace(/[^\x20-\x7E]/g, '_');
    const utf8Encoded = encodeURIComponent(job.filename).replace(/'/g, '%27');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stats.size);

    const readStream = fs.createReadStream(job.outputPath);
    readStream.pipe(res);

    logger.info('Streaming completed transcode', { jobId, filename: job.filename });
    return true;
  }

  /**
   * Process the transcode queue
   */
  private async processQueue(): Promise<void> {
    if (!this.db || !this.initialized) return;

    // Check for stale worker jobs and re-queue them
    const staleJobs = this.db.getStaleWorkerJobs(STALE_WORKER_TIMEOUT_MS);
    for (const job of staleJobs) {
      logger.warn('Re-queuing stale worker job', { jobId: job.id, workerId: job.workerId });
      this.db.resetStaleWorkerJob(job.id);
      // Mark the worker as offline
      if (job.workerId) {
        this.db.updateWorkerStatus(job.workerId, 'offline');
      }
    }

    // Check how many transcodes are currently active or starting
    const busyCount = this.activeTranscodes.size + this.startingTranscodes.size;
    if (busyCount >= this.maxConcurrent) {
      return;
    }

    // Get pending jobs
    const slotsAvailable = this.maxConcurrent - busyCount;
    const pendingJobs = this.db.getPendingTranscodeJobs(slotsAvailable);

    for (const job of pendingJobs) {
      // Double-check we don't already have this active or starting
      const cacheKey = this.getCacheKey(job.ratingKey, job.resolutionId);
      if (this.activeTranscodes.has(cacheKey) || this.startingTranscodes.has(cacheKey)) {
        continue;
      }

      // Reserve the slot before async work begins
      this.startingTranscodes.add(cacheKey);

      // Start this transcode
      this.startTranscode(job);
    }
  }

  /**
   * Start transcoding a job
   */
  private async startTranscode(job: TranscodeJob): Promise<void> {
    if (!this.db) return;

    const cacheKey = this.getCacheKey(job.ratingKey, job.resolutionId);
    const timestamp = Date.now();
    const outputPath = path.join(CACHE_DIR, `${cacheKey}-${timestamp}.mp4`);
    const inputTempPath = path.join(CACHE_DIR, `input-${cacheKey}-${timestamp}.tmp`);

    // Update job status
    this.db.updateTranscodeJobStatus(job.id, 'transcoding', {
      startedAt: Date.now(),
      outputPath,
    });

    logger.info('Starting transcode', {
      jobId: job.id,
      cacheKey,
      resolution: job.resolutionLabel,
      title: job.mediaTitle,
    });

    // Helper to clean up temp file (only if we downloaded it, not for local files)
    let useLocalFile = false; // Will be set to true if using local file access
    const cleanupTempFile = () => {
      if (useLocalFile) return; // Don't delete local files!
      try {
        if (fs.existsSync(inputTempPath)) {
          fs.unlinkSync(inputTempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    try {
      // Get Plex credentials from settings
      const serverUrl = this.db.getSetting('plex_url');
      const token = this.db.getSetting('plex_token');

      if (!serverUrl || !token) {
        throw new Error('Plex server not configured');
      }

      // Get media metadata to find the part key and file path
      plexService.setServerConnection(serverUrl, token);
      const metadata = await plexService.getMediaMetadata(job.ratingKey, token);

      const partKey = metadata.Media?.[0]?.Part?.[0]?.key;
      const plexFilePath = metadata.Media?.[0]?.Part?.[0]?.file;
      if (!partKey) {
        throw new Error('Media file not found');
      }

      const totalDuration = metadata.Media?.[0]?.duration || 0;
      const durationSeconds = totalDuration / 1000;

      // Detect hardware encoder
      const hwEncoder = await detectHardwareEncoder();

      // Try to use local file access if path mappings are configured
      let inputPath = inputTempPath;

      if (plexFilePath) {
        const pathMappingsJson = this.db.getSetting('path_mappings') || '[]';
        let pathMappings: Array<{ plexPath: string; localPath: string }> = [];
        try {
          pathMappings = JSON.parse(pathMappingsJson);
        } catch {
          pathMappings = [];
        }

        // Try to map Plex path to local path
        for (const mapping of pathMappings) {
          if (plexFilePath.startsWith(mapping.plexPath)) {
            const localFilePath = plexFilePath.replace(mapping.plexPath, mapping.localPath);

            // SECURITY: Validate the path is safe (no path traversal)
            if (!isPathSafe(localFilePath)) {
              logger.warn('Path traversal attempt detected in local file path', {
                jobId: job.id,
                plexPath: plexFilePath,
                localPath: localFilePath,
              });
              continue;
            }

            // SECURITY: Validate path is within allowed mappings
            if (!isPathWithinMappings(localFilePath, pathMappings)) {
              logger.warn('Local file path is not within allowed path mappings', {
                jobId: job.id,
                localPath: localFilePath,
              });
              continue;
            }

            if (fs.existsSync(localFilePath)) {
              inputPath = localFilePath;
              useLocalFile = true;
              logger.info('Using local file access', {
                jobId: job.id,
                plexPath: plexFilePath,
                localPath: localFilePath,
              });
              break;
            } else {
              logger.warn('Local file not found, falling back to HTTP download', {
                jobId: job.id,
                localPath: localFilePath,
              });
            }
          }
        }
      }

      // If no local file access, download via HTTP
      if (!useLocalFile) {
        const downloadUrl = plexService.getDirectDownloadUrl(partKey, token);
        logger.info('Downloading source file via HTTP', { jobId: job.id, title: job.mediaTitle });

        const plexResponse = await axios({
          method: 'GET',
          url: downloadUrl,
          responseType: 'stream',
          httpsAgent,
        });

        // Write to temp file
        const writeStream = fs.createWriteStream(inputTempPath);
        await new Promise<void>((resolve, reject) => {
          plexResponse.data.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          plexResponse.data.on('error', reject);
        });
      }

      logger.info('Starting encode', {
        jobId: job.id,
        hwEncoder: hwEncoder || 'software',
        title: job.mediaTitle,
        inputFile: inputPath,
        outputFile: outputPath,
        localFileAccess: useLocalFile,
      });

      // Probe for text-based subtitle streams (PGS/bitmap subs can't go into MP4)
      const subtitleStreams = getTextSubtitleStreams(inputPath);

      // Build ffmpeg arguments based on encoder type
      let ffmpegArgs: string[];

      // Subtitle mapping args: map each text subtitle stream by absolute index
      const subtitleMapArgs: string[] = [];
      for (const idx of subtitleStreams) {
        subtitleMapArgs.push('-map', `0:${idx}`);
      }
      // If we mapped any subtitle streams, set codec to mov_text (MP4 text subs)
      const subtitleCodecArgs = subtitleStreams.length > 0 ? ['-c:s', 'mov_text'] : [];

      if (hwEncoder === 'vaapi') {
        // VAAPI full hardware decode + encode (Intel/AMD)
        // -hwaccel vaapi offloads decoding to GPU; falls back to software if codec unsupported
        // -hwaccel_output_format vaapi keeps decoded frames on GPU (no CPU round-trip)
        ffmpegArgs = [
          '-hwaccel', 'vaapi',
          '-hwaccel_device', '/dev/dri/renderD128',
          '-hwaccel_output_format', 'vaapi',
          '-i', inputPath,
          '-map', '0:v:0',           // Map first video stream
          '-map', '0:a?',            // Map all audio streams (optional)
          ...subtitleMapArgs,         // Map text subtitle streams
          '-vf', `scale_vaapi=w=-2:h=${job.resolutionHeight}:format=nv12`,
          '-c:v', 'h264_vaapi',
          '-profile:v', '77',        // Main profile
          '-level', '40',            // Level 4.0
          '-b:v', `${job.maxBitrate}k`,
          '-maxrate', `${job.maxBitrate}k`,
          '-bufsize', `${(job.maxBitrate || 4000) * 2}k`,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ac', '2',
          '-ar', '48000',
          ...subtitleCodecArgs,       // Set subtitle codec if subs present
          '-map_metadata', '0',      // Copy all metadata
          '-map_chapters', '0',      // Copy chapters
          '-movflags', '+faststart',
          '-f', 'mp4',
          '-y',
          outputPath
        ];
      } else if (hwEncoder === 'qsv') {
        // Intel Quick Sync full hardware decode + encode
        // -hwaccel qsv offloads decoding to GPU; falls back to software if codec unsupported
        // -hwaccel_output_format qsv keeps decoded frames on GPU (no CPU round-trip)
        ffmpegArgs = [
          '-hwaccel', 'qsv',
          '-hwaccel_output_format', 'qsv',
          '-extra_hw_frames', '64',
          '-i', inputPath,
          '-map', '0:v:0',           // Map first video stream
          '-map', '0:a?',            // Map all audio streams (optional)
          ...subtitleMapArgs,         // Map text subtitle streams
          '-vf', `scale_qsv=w=-2:h=${job.resolutionHeight}`,
          '-c:v', 'h264_qsv',
          '-profile:v', 'main',
          '-level', '40',
          '-b:v', `${job.maxBitrate}k`,
          '-maxrate', `${job.maxBitrate}k`,
          '-bufsize', `${(job.maxBitrate || 4000) * 2}k`,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ac', '2',
          '-ar', '48000',
          ...subtitleCodecArgs,       // Set subtitle codec if subs present
          '-map_metadata', '0',      // Copy all metadata
          '-map_chapters', '0',      // Copy chapters
          '-movflags', '+faststart',
          '-f', 'mp4',
          '-y',
          outputPath
        ];
      } else {
        // Software encoding (libx264)
        ffmpegArgs = [
          '-i', inputPath,
          '-map', '0:v:0',           // Map first video stream
          '-map', '0:a?',            // Map all audio streams (optional)
          ...subtitleMapArgs,         // Map text subtitle streams
          '-vf', `scale=-2:${job.resolutionHeight}`,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-tune', 'film',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-crf', '23',
          '-maxrate', `${job.maxBitrate}k`,
          '-bufsize', `${(job.maxBitrate || 4000) * 2}k`,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ac', '2',
          '-ar', '48000',
          ...subtitleCodecArgs,       // Set subtitle codec if subs present
          '-map_metadata', '0',      // Copy all metadata
          '-map_chapters', '0',      // Copy chapters
          '-threads', '0',
          '-movflags', '+faststart',
          '-f', 'mp4',
          '-y',
          outputPath
        ];
      }

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Track this as active (move from starting to active)
      this.startingTranscodes.delete(cacheKey);
      const activeTranscode: ActiveTranscode = {
        jobId: job.id,
        ffmpegProcess: ffmpeg,
        subscribers: new Set(),
      };
      this.activeTranscodes.set(cacheKey, activeTranscode);

      // Capture stderr for error reporting
      let stderrOutput = '';

      // Parse ffmpeg stderr for progress
      ffmpeg.stderr.on('data', (data: Buffer) => {
        const output = data.toString();

        // Keep last 2000 chars of stderr for error reporting
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

          // Update database
          if (this.db) {
            this.db.updateTranscodeJobProgress(job.id, progress);
          }
        }
      });

      ffmpeg.on('error', (err) => {
        logger.error('ffmpeg process error', { error: err.message, jobId: job.id, stderr: stderrOutput });
        cleanupTempFile();
        this.handleTranscodeError(job.id, cacheKey, err.message);
      });

      ffmpeg.on('close', (code) => {
        cleanupTempFile();
        if (code === 0) {
          this.handleTranscodeComplete(job.id, cacheKey, outputPath);
        } else {
          const currentJob = this.db?.getTranscodeJob(job.id);
          if (currentJob?.status !== 'cancelled') {
            logger.error('ffmpeg failed', { jobId: job.id, exitCode: code, stderr: stderrOutput });
            this.handleTranscodeError(job.id, cacheKey, `ffmpeg exited with code ${code}`);
          }
        }
      });

    } catch (error: any) {
      this.startingTranscodes.delete(cacheKey);
      cleanupTempFile();
      logger.error('Failed to start transcode', {
        jobId: job.id,
        error: error.message,
      });
      this.handleTranscodeError(job.id, cacheKey, error.message);
    }
  }

  private handleTranscodeComplete(jobId: string, cacheKey: string, outputPath: string): void {
    if (!this.db) return;

    // Get file size
    let fileSize: number | undefined;
    try {
      const stats = fs.statSync(outputPath);
      fileSize = stats.size;
    } catch {
      // Ignore
    }

    // Update job status
    this.db.updateTranscodeJobStatus(jobId, 'completed', {
      progress: 100,
      completedAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
      fileSize,
    });

    // Remove from active
    this.activeTranscodes.delete(cacheKey);

    logger.info('Transcode completed', { jobId, cacheKey, fileSize });

    // Process next in queue
    this.processQueue();
  }

  private handleTranscodeError(jobId: string, cacheKey: string, errorMessage: string): void {
    if (!this.db) return;

    // Update job status
    this.db.updateTranscodeJobStatus(jobId, 'error', {
      error: errorMessage,
    });

    // Clean up active
    const active = this.activeTranscodes.get(cacheKey);
    if (active) {
      for (const res of active.subscribers) {
        if (!res.writableEnded) {
          res.end();
        }
      }
      this.activeTranscodes.delete(cacheKey);
    }

    // Clean up partial file
    const job = this.db.getTranscodeJob(jobId);
    if (job?.outputPath && fs.existsSync(job.outputPath)) {
      try {
        fs.unlinkSync(job.outputPath);
      } catch {
        // Ignore
      }
    }

    logger.error('Transcode failed', { jobId, cacheKey, error: errorMessage });

    // Process next in queue
    this.processQueue();
  }

  /**
   * Clean up expired files
   */
  private cleanupExpiredFiles(): void {
    if (!this.db || !this.initialized) return;

    // Get and delete expired jobs from database
    const expiredJobs = this.db.cleanupExpiredTranscodeJobs();

    // Delete the files
    for (const job of expiredJobs) {
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        try {
          fs.unlinkSync(job.outputPath);
          logger.info('Cleaned up expired transcode file', { jobId: job.id, path: job.outputPath });
        } catch {
          logger.warn('Failed to delete expired transcode file', { path: job.outputPath });
        }
      }
    }

    // Also clean up any orphaned files in the cache directory
    try {
      const files = fs.readdirSync(CACHE_DIR);
      const now = Date.now();
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

    if (this.workerInterval) {
      clearInterval(this.workerInterval);
    }

    // Kill all active transcodes
    for (const [, active] of this.activeTranscodes) {
      if (!active.ffmpegProcess.killed) {
        active.ffmpegProcess.kill('SIGTERM');
      }
    }

    this.activeTranscodes.clear();
    this.startingTranscodes.clear();
  }

  /**
   * Handle a completed worker job (called by worker route when upload finishes)
   */
  handleWorkerJobComplete(jobId: string, outputPath: string, fileSize: number): void {
    if (!this.db) return;

    this.db.updateTranscodeJobStatus(jobId, 'completed', {
      progress: 100,
      outputPath,
      fileSize,
      completedAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    logger.info('Worker transcode completed', { jobId, outputPath, fileSize });
  }

  // Legacy compatibility methods for existing code
  getProgress(cacheKey: string): { progress: number; status: string } | null {
    const [ratingKey, resolutionId] = cacheKey.split('-');
    const job = this.getJobByCacheKey(ratingKey, resolutionId);
    if (!job) return null;
    return { progress: job.progress, status: job.status };
  }
}

// Singleton instance
export const transcodeManager = new TranscodeManager();
