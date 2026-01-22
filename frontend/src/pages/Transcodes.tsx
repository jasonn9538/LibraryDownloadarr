import React, { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { api, TranscodeJob } from '../services/api';

export const Transcodes: React.FC = () => {
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const [jobs, setJobs] = useState<TranscodeJob[]>([]);
  const [availableJobs, setAvailableJobs] = useState<TranscodeJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllAvailable, setShowAllAvailable] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const [userJobs, available] = await Promise.all([
        api.getTranscodeJobs(),
        api.getAvailableTranscodes(),
      ]);
      setJobs(userJobs);
      setAvailableJobs(available);
    } catch (error) {
      console.error('Failed to load transcode jobs:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    // Poll for updates every 3 seconds
    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleCancel = async (jobId: string) => {
    try {
      await api.cancelTranscode(jobId);
      loadJobs();
    } catch (error) {
      console.error('Failed to cancel transcode:', error);
    }
  };

  const handleDownload = async (job: TranscodeJob) => {
    setDownloadingJobId(job.id);
    try {
      const url = api.getTranscodeJobDownloadUrl(job.id);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = job.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download:', error);
    } finally {
      setDownloadingJobId(null);
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTimeRemaining = (expiresAt?: number): string => {
    if (!expiresAt) return '';
    const now = Date.now();
    const remaining = expiresAt - now;
    if (remaining <= 0) return 'Expired';

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  // Filter jobs by status
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const transcodingJobs = jobs.filter(j => j.status === 'transcoding');
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const errorJobs = jobs.filter(j => j.status === 'error');

  // Get available jobs that aren't in user's jobs (from other users)
  const userJobIds = new Set(jobs.map(j => j.id));
  const otherAvailableJobs = availableJobs.filter(j => !userJobIds.has(j.id));

  const renderJobCard = (job: TranscodeJob, showOwner: boolean = false) => (
    <div
      key={job.id}
      className="bg-dark-100 border border-dark-50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-white truncate">{job.mediaTitle}</h3>
          <span className="px-2 py-0.5 text-xs bg-dark-200 text-gray-300 rounded">
            {job.resolutionLabel}
          </span>
        </div>
        <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {job.status === 'completed' && (
            <>
              <span>{formatFileSize(job.fileSize)}</span>
              <span className="text-green-400">{formatTimeRemaining(job.expiresAt)}</span>
            </>
          )}
          {job.status === 'transcoding' && (
            <span className="text-blue-400">Transcoding... {job.progress}%</span>
          )}
          {job.status === 'pending' && (
            <span className="text-gray-400">Waiting in queue...</span>
          )}
          {job.status === 'error' && (
            <span className="text-red-400">{job.error || 'Transcode failed'}</span>
          )}
          {showOwner && job.username && (
            <span className="text-gray-500">by {job.username}</span>
          )}
        </div>
        {job.status === 'transcoding' && (
          <div className="mt-2 w-full bg-dark-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {job.status === 'completed' && (
          <button
            onClick={() => handleDownload(job)}
            disabled={downloadingJobId === job.id}
            className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
          >
            {downloadingJobId === job.id ? (
              <>
                <span className="animate-spin">⏳</span>
                Downloading...
              </>
            ) : (
              <>
                <span>⬇️</span>
                Download
              </>
            )}
          </button>
        )}
        {(job.status === 'pending' || job.status === 'transcoding') && (
          <button
            onClick={() => handleCancel(job.id)}
            className="btn-secondary px-4 py-2 text-sm text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        )}
        {(job.status === 'error' || job.status === 'completed') && (
          <button
            onClick={() => handleCancel(job.id)}
            className="px-3 py-2 text-sm text-gray-400 hover:text-gray-300"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-dark">
      <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header onMenuClick={toggleMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Transcodes</h2>
            <p className="text-gray-400 mb-6">
              Manage your transcoding queue and download completed files. Files are available for 1 week after completion.
            </p>

            {isLoading ? (
              <div className="text-center text-gray-400 py-8">Loading...</div>
            ) : (
              <div className="space-y-8">
                {/* Ready to Download */}
                {completedJobs.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold text-green-400 mb-3 flex items-center gap-2">
                      <span>✅</span>
                      Ready to Download ({completedJobs.length})
                    </h3>
                    <div className="space-y-3">
                      {completedJobs.map(job => renderJobCard(job))}
                    </div>
                  </section>
                )}

                {/* Processing */}
                {transcodingJobs.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold text-blue-400 mb-3 flex items-center gap-2">
                      <span className="animate-pulse">⚙️</span>
                      Processing ({transcodingJobs.length})
                    </h3>
                    <div className="space-y-3">
                      {transcodingJobs.map(job => renderJobCard(job))}
                    </div>
                  </section>
                )}

                {/* Queued */}
                {pendingJobs.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold text-gray-400 mb-3 flex items-center gap-2">
                      <span>⏳</span>
                      Queued ({pendingJobs.length})
                    </h3>
                    <div className="space-y-3">
                      {pendingJobs.map(job => renderJobCard(job))}
                    </div>
                  </section>
                )}

                {/* Errors */}
                {errorJobs.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold text-red-400 mb-3 flex items-center gap-2">
                      <span>❌</span>
                      Failed ({errorJobs.length})
                    </h3>
                    <div className="space-y-3">
                      {errorJobs.map(job => renderJobCard(job))}
                    </div>
                  </section>
                )}

                {/* Empty state */}
                {jobs.length === 0 && !showAllAvailable && (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-4xl mb-4">📥</div>
                    <p className="text-lg mb-2">No transcodes yet</p>
                    <p className="text-sm">
                      When you download a video with a different resolution, it will appear here.
                    </p>
                  </div>
                )}

                {/* All Available Toggle */}
                {otherAvailableJobs.length > 0 && (
                  <section className="pt-4 border-t border-dark-50">
                    <button
                      onClick={() => setShowAllAvailable(!showAllAvailable)}
                      className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 mb-3"
                    >
                      <span>{showAllAvailable ? '▼' : '▶'}</span>
                      <span>
                        Show all available transcodes ({otherAvailableJobs.length} from other users)
                      </span>
                    </button>
                    {showAllAvailable && (
                      <div className="space-y-3">
                        {otherAvailableJobs.map(job => renderJobCard(job, true))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
