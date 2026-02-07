import React, { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { api, TranscodeJob } from '../services/api';

export const Transcodes: React.FC = () => {
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const [jobs, setJobs] = useState<TranscodeJob[]>([]);
  const [allJobs, setAllJobs] = useState<TranscodeJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const loadJobs = useCallback(async () => {
    try {
      const [userJobs, all] = await Promise.all([
        api.getTranscodeJobs(),
        api.getAllTranscodes(),
      ]);
      setJobs(userJobs);
      setAllJobs(all);
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

  const handleRetry = async (job: TranscodeJob) => {
    try {
      // Delete the failed job first, then queue a new one
      await api.cancelTranscode(job.id);
      await api.queueTranscode(job.ratingKey, job.resolutionId);
      loadJobs();
    } catch (error) {
      console.error('Failed to retry transcode:', error);
    }
  };

  const handleDownload = (job: TranscodeJob) => {
    // Use direct browser download with token in query string
    const token = localStorage.getItem('token');
    const url = `${api.getTranscodeJobDownloadUrl(job.id)}?token=${encodeURIComponent(token || '')}`;

    // Create a temporary anchor tag to trigger the download
    const link = document.createElement('a');
    link.href = url;
    link.download = job.filename || 'download.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  const formatEta = (job: TranscodeJob): string => {
    if (!job.startedAt || job.progress <= 0) return '';

    const now = Date.now();
    const elapsed = now - job.startedAt;

    // Need at least 5 seconds of data for a reasonable estimate
    if (elapsed < 5000) return 'Calculating...';

    // Calculate rate: progress per millisecond
    const rate = job.progress / elapsed;
    if (rate <= 0) return '';

    // Calculate remaining time
    const remainingProgress = 100 - job.progress;
    const remainingMs = remainingProgress / rate;

    // Format the ETA
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds < 60) return `~${seconds}s remaining`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return `~${minutes}m ${remainingSeconds}s remaining`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `~${hours}h ${remainingMinutes}m remaining`;
  };

  // Choose which jobs to display based on toggle
  const displayJobs = showAll ? allJobs : jobs;

  // Filter jobs by status
  const completedJobs = displayJobs.filter(j => j.status === 'completed');
  const transcodingJobs = displayJobs.filter(j => j.status === 'transcoding');
  const pendingJobs = displayJobs.filter(j => j.status === 'pending');
  const errorJobs = displayJobs.filter(j => j.status === 'error');

  // Get user's job IDs to identify their own jobs
  const userJobIds = new Set(jobs.map(j => j.id));

  const renderJobCard = (job: TranscodeJob) => {
    const isOwnJob = userJobIds.has(job.id);

    return (
      <div
        key={job.id}
        className={`bg-dark-100 border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
          showAll && !isOwnJob ? 'border-dark-50 opacity-80' : 'border-dark-50'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-white truncate">{job.mediaTitle}</h3>
            <span className="px-2 py-0.5 text-xs bg-dark-200 text-gray-300 rounded">
              {job.resolutionLabel}
            </span>
            {showAll && job.username && (
              <span className="px-2 py-0.5 text-xs bg-dark-200 text-gray-500 rounded">
                by {job.username}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {job.status === 'completed' && (
              <>
                <span>{formatFileSize(job.fileSize)}</span>
                <span className="text-green-400">{formatTimeRemaining(job.expiresAt)}</span>
              </>
            )}
            {job.status === 'transcoding' && (
              <span className="text-blue-400">
                {job.progress === 0 ? (
                  'Preparing to transcode...'
                ) : (
                  <>
                    Transcoding... {job.progress}%
                    <span className="text-gray-500 ml-2">{formatEta(job)}</span>
                  </>
                )}
              </span>
            )}
            {job.status === 'pending' && (
              <span className="text-gray-400">Waiting in queue...</span>
            )}
            {job.status === 'error' && (
              <span className="text-red-400">{job.error || 'Transcode failed'}</span>
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
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            >
              <span>⬇️</span>
              Download
            </button>
          )}
          {(job.status === 'pending' || job.status === 'transcoding') && isOwnJob && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to cancel this transcode?')) {
                  handleCancel(job.id);
                }
              }}
              className="btn-secondary px-4 py-2 text-sm text-red-400 hover:text-red-300"
            >
              Cancel
            </button>
          )}
          {job.status === 'error' && isOwnJob && (
            <button
              onClick={() => handleRetry(job)}
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            >
              <span>🔄</span>
              Retry
            </button>
          )}
          {(job.status === 'error' || job.status === 'completed') && isOwnJob && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to remove this transcode? The file will be deleted.')) {
                  handleCancel(job.id);
                }
              }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-300"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl md:text-3xl font-bold">Transcodes</h2>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  className="rounded border-gray-600 bg-dark-200 text-primary-500 focus:ring-primary-500"
                />
                Show all users
              </label>
            </div>
            <p className="text-gray-400 mb-6">
              {showAll
                ? 'Showing all transcodes from all users. Files are kept for 7 days after last download.'
                : 'Manage your transcoding queue and download completed files. Files are kept for 7 days after last download.'
              }
            </p>

            {isLoading ? (
              <div className="text-center text-gray-400 py-8">Loading...</div>
            ) : (
              <div className="space-y-8">
                {/* Ready to Download */}
                {completedJobs.length > 0 && (
                  <section>
                    <button
                      onClick={() => setCollapsedSections(s => ({ ...s, completed: !s.completed }))}
                      className="text-lg font-semibold text-green-400 mb-3 flex items-center gap-2 w-full text-left hover:text-green-300 transition-colors"
                    >
                      <span className={`transition-transform ${collapsedSections.completed ? '' : 'rotate-90'}`}>▶</span>
                      <span>✅</span>
                      Ready to Download ({completedJobs.length})
                    </button>
                    {!collapsedSections.completed && (
                      <div className="space-y-3">
                        {completedJobs.map(job => renderJobCard(job))}
                      </div>
                    )}
                  </section>
                )}

                {/* Processing */}
                {transcodingJobs.length > 0 && (
                  <section>
                    <button
                      onClick={() => setCollapsedSections(s => ({ ...s, transcoding: !s.transcoding }))}
                      className="text-lg font-semibold text-blue-400 mb-3 flex items-center gap-2 w-full text-left hover:text-blue-300 transition-colors"
                    >
                      <span className={`transition-transform ${collapsedSections.transcoding ? '' : 'rotate-90'}`}>▶</span>
                      <span className="animate-pulse">⚙️</span>
                      Processing ({transcodingJobs.length})
                    </button>
                    {!collapsedSections.transcoding && (
                      <div className="space-y-3">
                        {transcodingJobs.map(job => renderJobCard(job))}
                      </div>
                    )}
                  </section>
                )}

                {/* Queued */}
                {pendingJobs.length > 0 && (
                  <section>
                    <button
                      onClick={() => setCollapsedSections(s => ({ ...s, pending: !s.pending }))}
                      className="text-lg font-semibold text-gray-400 mb-3 flex items-center gap-2 w-full text-left hover:text-gray-300 transition-colors"
                    >
                      <span className={`transition-transform ${collapsedSections.pending ? '' : 'rotate-90'}`}>▶</span>
                      <span>⏳</span>
                      Queued ({pendingJobs.length})
                    </button>
                    {!collapsedSections.pending && (
                      <div className="space-y-3">
                        {pendingJobs.map(job => renderJobCard(job))}
                      </div>
                    )}
                  </section>
                )}

                {/* Errors */}
                {errorJobs.length > 0 && (
                  <section>
                    <button
                      onClick={() => setCollapsedSections(s => ({ ...s, error: !s.error }))}
                      className="text-lg font-semibold text-red-400 mb-3 flex items-center gap-2 w-full text-left hover:text-red-300 transition-colors"
                    >
                      <span className={`transition-transform ${collapsedSections.error ? '' : 'rotate-90'}`}>▶</span>
                      <span>❌</span>
                      Failed ({errorJobs.length})
                    </button>
                    {!collapsedSections.error && (
                      <div className="space-y-3">
                        {errorJobs.map(job => renderJobCard(job))}
                      </div>
                    )}
                  </section>
                )}

                {/* Empty state */}
                {displayJobs.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-4xl mb-4">📥</div>
                    <p className="text-lg mb-2">
                      {showAll ? 'No transcodes in progress' : 'No transcodes yet'}
                    </p>
                    <p className="text-sm">
                      {showAll
                        ? 'When anyone starts a transcode, it will appear here.'
                        : 'When you download a video with a different resolution, it will appear here.'
                      }
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
