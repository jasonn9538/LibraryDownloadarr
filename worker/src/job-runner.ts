import fs from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import { ChildProcess } from 'child_process';
import { config } from './config';
import { logger } from './logger';
import { ApiClient, ClaimedJob } from './api-client';
import { transcode } from './transcoder';
import { GpuCapabilities } from './gpu-detector';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export class JobRunner {
  private apiClient: ApiClient;
  private gpuCapabilities: GpuCapabilities;
  private activeJobs: Map<string, ChildProcess> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(apiClient: ApiClient, gpuCapabilities: GpuCapabilities) {
    this.apiClient = apiClient;
    this.gpuCapabilities = gpuCapabilities;
  }

  start(): void {
    logger.info('Job runner started', { maxConcurrent: config.maxConcurrent });

    // Ensure temp directory exists
    if (!fs.existsSync(config.tempDir)) {
      fs.mkdirSync(config.tempDir, { recursive: true });
    }

    // Start polling for jobs
    this.pollInterval = setInterval(() => this.pollForJobs(), config.pollIntervalMs);

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), config.heartbeatIntervalMs);

    // Initial poll
    this.pollForJobs();
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    logger.info('Stopping job runner...');

    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Kill active ffmpeg processes
    for (const [jobId, process] of this.activeJobs) {
      logger.info('Killing active transcode', { jobId });
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    }

    // Wait briefly for processes to finish
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clean up temp files
    this.cleanupTempDir();
  }

  private async pollForJobs(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.activeJobs.size >= config.maxConcurrent) return;

    try {
      const claimed = await this.apiClient.claimJob();
      if (!claimed) return;

      logger.info('Claimed job', {
        jobId: claimed.job.id,
        title: claimed.job.mediaTitle,
        resolution: claimed.job.resolutionLabel,
      });

      // Process job in background
      this.processJob(claimed).catch(error => {
        logger.error('Job processing failed', {
          jobId: claimed.job.id,
          error: error.message,
        });
      });
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        logger.warn('Cannot reach server, will retry...');
      } else {
        logger.error('Error polling for jobs', { error: error.message });
      }
    }
  }

  private async processJob(claimed: ClaimedJob): Promise<void> {
    const { job, plex } = claimed;
    const inputPath = path.join(config.tempDir, `input-${job.id}.tmp`);
    const outputPath = path.join(config.tempDir, `output-${job.id}.mp4`);

    try {
      // Step 1: Get media metadata to find the part key and duration
      logger.info('Fetching media metadata', { jobId: job.id, ratingKey: job.ratingKey });
      const metadataUrl = `${plex.serverUrl}/library/metadata/${job.ratingKey}?X-Plex-Token=${plex.token}`;
      const metadataResponse = await axios.get(metadataUrl, { httpsAgent });
      const metadata = metadataResponse.data?.MediaContainer?.Metadata?.[0];
      const partKey = metadata?.Media?.[0]?.Part?.[0]?.key;
      const duration = metadata?.Media?.[0]?.duration || 0;
      const durationSeconds = duration / 1000;

      if (!partKey) {
        throw new Error('Could not find media part key');
      }

      // Step 2: Download source file
      const downloadUrl = `${plex.serverUrl}${partKey}?download=1&X-Plex-Token=${plex.token}`;
      logger.info('Downloading source file', { jobId: job.id });

      const downloadResponse = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        httpsAgent,
      });

      const writeStream = fs.createWriteStream(inputPath);
      await new Promise<void>((resolve, reject) => {
        downloadResponse.data.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        downloadResponse.data.on('error', reject);
      });

      logger.info('Source file downloaded', {
        jobId: job.id,
        size: fs.statSync(inputPath).size,
      });

      // Step 3: Transcode
      const { process: ffmpegProcess, promise: transcodePromise } = transcode(
        {
          inputPath,
          outputPath,
          encoder: this.gpuCapabilities.bestEncoder,
          resolutionHeight: job.resolutionHeight,
          maxBitrate: job.maxBitrate,
        },
        async (progress) => {
          // Report progress to server
          try {
            const ok = await this.apiClient.reportProgress(job.id, progress);
            if (!ok) {
              // Job was cancelled
              logger.info('Job cancelled by server, aborting', { jobId: job.id });
              if (!ffmpegProcess.killed) {
                ffmpegProcess.kill('SIGTERM');
              }
            }
          } catch {
            // Non-fatal — we'll try again on next progress update
          }
        },
        durationSeconds,
      );

      this.activeJobs.set(job.id, ffmpegProcess);

      const result = await transcodePromise;

      this.activeJobs.delete(job.id);

      if (!result.success) {
        throw new Error(result.error || 'Transcode failed');
      }

      // Step 4: Upload completed file
      logger.info('Uploading completed transcode', { jobId: job.id });

      let uploaded = false;
      for (let attempt = 1; attempt <= config.uploadRetries; attempt++) {
        try {
          await this.apiClient.uploadComplete(job.id, outputPath);
          uploaded = true;
          break;
        } catch (error: any) {
          if (error.response?.status === 410) {
            logger.warn('Job was cancelled during upload', { jobId: job.id });
            break;
          }
          logger.warn('Upload attempt failed', { jobId: job.id, attempt, error: error.message });
          if (attempt < config.uploadRetries) {
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
          }
        }
      }

      if (!uploaded) {
        throw new Error('Failed to upload after retries');
      }

      logger.info('Job completed successfully', { jobId: job.id, title: job.mediaTitle });

    } catch (error: any) {
      this.activeJobs.delete(job.id);
      logger.error('Job failed', { jobId: job.id, error: error.message });

      try {
        await this.apiClient.reportError(job.id, error.message);
      } catch {
        logger.warn('Failed to report error to server', { jobId: job.id });
      }
    } finally {
      // Clean up temp files
      this.cleanupFile(inputPath);
      this.cleanupFile(outputPath);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await this.apiClient.heartbeat(this.activeJobs.size);
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        logger.debug('Heartbeat failed: server unreachable');
      } else {
        logger.warn('Heartbeat failed', { error: error.message });
      }
    }
  }

  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private cleanupTempDir(): void {
    try {
      const files = fs.readdirSync(config.tempDir);
      for (const file of files) {
        this.cleanupFile(path.join(config.tempDir, file));
      }
    } catch {
      // Ignore
    }
  }
}
