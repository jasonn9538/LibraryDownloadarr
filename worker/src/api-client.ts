import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { config } from './config';
import { logger } from './logger';
import { GpuCapabilities } from './gpu-detector';

export interface ClaimedJob {
  job: {
    id: string;
    ratingKey: string;
    resolutionId: string;
    resolutionLabel: string;
    resolutionHeight: number;
    maxBitrate: number;
    mediaTitle: string;
    mediaType: string;
    filename: string;
    durationSeconds: number;
  };
}

export class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${config.serverUrl}/api/worker`,
      headers: {
        'Authorization': `Bearer ${config.workerKey}`,
        'X-Worker-Id': config.workerId,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async register(capabilities: GpuCapabilities): Promise<void> {
    await this.client.post('/register', {
      id: config.workerId,
      name: config.workerName,
      capabilities: {
        ...capabilities,
        maxConcurrent: config.maxConcurrent,
        os: process.platform,
        arch: process.arch,
      },
    });
    logger.info('Registered with server', { workerId: config.workerId, name: config.workerName });
  }

  async claimJob(): Promise<ClaimedJob | null> {
    try {
      const response = await this.client.get('/claim');
      if (response.status === 204) {
        return null;
      }
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 204) return null;
      throw error;
    }
  }

  async reportProgress(jobId: string, progress: number): Promise<boolean> {
    try {
      await this.client.put(`/jobs/${jobId}/progress`, { progress });
      return true;
    } catch (error: any) {
      if (error.response?.status === 410) {
        logger.warn('Job was cancelled by server', { jobId });
        return false; // Job cancelled
      }
      throw error;
    }
  }

  async uploadComplete(jobId: string, filePath: string): Promise<void> {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: `${jobId}.mp4`,
      contentType: 'video/mp4',
    });

    await this.client.post(`/jobs/${jobId}/complete`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${config.workerKey}`,
        'X-Worker-Id': config.workerId,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 0, // No timeout for large file uploads
    });
  }

  async downloadSource(jobId: string, destPath: string): Promise<void> {
    const response = await this.client.get(`/jobs/${jobId}/source`, {
      responseType: 'stream',
      timeout: 0, // No timeout for large downloads
    });

    const writeStream = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      response.data.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      response.data.on('error', reject);
    });
  }

  async reportError(jobId: string, error: string): Promise<void> {
    await this.client.post(`/jobs/${jobId}/error`, { error });
  }

  async heartbeat(activeJobs: number): Promise<void> {
    await this.client.post('/heartbeat', { activeJobs });
  }
}
