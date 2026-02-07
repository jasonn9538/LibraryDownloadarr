import { config } from './config';
import { logger } from './logger';
import { detectGpu } from './gpu-detector';
import { ApiClient } from './api-client';
import { JobRunner } from './job-runner';

async function main(): Promise<void> {
  logger.info('LibraryDownloadarr Worker starting', {
    name: config.workerName,
    id: config.workerId,
    server: config.serverUrl,
    maxConcurrent: config.maxConcurrent,
  });

  if (!config.workerKey) {
    logger.error('WORKER_KEY environment variable is required');
    process.exit(1);
  }

  // Step 1: Detect GPU capabilities
  logger.info('Detecting GPU capabilities...');
  const gpuCapabilities = detectGpu();

  // Step 2: Create API client and register with server
  const apiClient = new ApiClient();

  let registered = false;
  while (!registered) {
    try {
      await apiClient.register(gpuCapabilities);
      registered = true;
    } catch (error: any) {
      logger.warn('Failed to register with server, retrying in 10s...', {
        error: error.message,
        server: config.serverUrl,
      });
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  // Step 3: Start job runner
  const jobRunner = new JobRunner(apiClient, gpuCapabilities);
  jobRunner.start();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    await jobRunner.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});
