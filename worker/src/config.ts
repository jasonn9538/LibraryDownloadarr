export const config = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:5069',
  workerKey: process.env.WORKER_KEY || '',
  workerName: process.env.WORKER_NAME || `worker-${require('os').hostname()}`,
  workerId: process.env.WORKER_ID || `worker-${require('os').hostname()}-${Date.now()}`,
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '1', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
  tempDir: process.env.TEMP_DIR || '/tmp/transcode',
  uploadRetries: parseInt(process.env.UPLOAD_RETRIES || '3', 10),
};
