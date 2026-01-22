import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { api } from '../services/api';

interface Download {
  id: string;
  ratingKey: string;
  partKey: string;
  filename: string;
  title: string;
  progress: number;
  status: 'downloading' | 'completed' | 'error';
  error?: string;
  isBulkDownload?: boolean; // True for season/album zips (no progress tracking)
  isTranscoded?: boolean; // True for transcoded downloads
  resolution?: string; // Resolution label for display
  transcodeCacheKey?: string; // Cache key for polling transcode progress
}

interface DownloadContextType {
  downloads: Download[];
  startDownload: (
    ratingKey: string,
    partKey: string,
    filename: string,
    title: string,
    options?: { resolutionId?: string; resolutionLabel?: string; isOriginal?: boolean }
  ) => Promise<void>;
  removeDownload: (id: string) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const useDownloads = () => {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloads must be used within a DownloadProvider');
  }
  return context;
};

interface DownloadProviderProps {
  children: ReactNode;
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({ children }) => {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const progressPollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Warn user before closing/refreshing if downloads are in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const activeDownloads = downloads.filter(d => d.status === 'downloading');

      if (activeDownloads.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [downloads]);

  // Clean up pollers on unmount
  useEffect(() => {
    return () => {
      progressPollersRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);

  // Start polling for transcode progress
  const startProgressPolling = (downloadId: string, cacheKey: string) => {
    // Don't start if already polling
    if (progressPollersRef.current.has(downloadId)) return;

    const pollInterval = setInterval(async () => {
      try {
        const progressData = await api.getTranscodeProgress(cacheKey);

        setDownloads((prev) =>
          prev.map((d) =>
            d.id === downloadId
              ? { ...d, progress: progressData.progress }
              : d
          )
        );

        // Stop polling if completed or error
        if (progressData.status === 'completed' || progressData.status === 'error') {
          clearInterval(pollInterval);
          progressPollersRef.current.delete(downloadId);
        }
      } catch (err) {
        // Job might be finished, stop polling
        clearInterval(pollInterval);
        progressPollersRef.current.delete(downloadId);
      }
    }, 1000); // Poll every second

    progressPollersRef.current.set(downloadId, pollInterval);
  };

  const stopProgressPolling = (downloadId: string) => {
    const interval = progressPollersRef.current.get(downloadId);
    if (interval) {
      clearInterval(interval);
      progressPollersRef.current.delete(downloadId);
    }
  };

  const startDownload = async (
    ratingKey: string,
    partKey: string,
    filename: string,
    title: string,
    options?: { resolutionId?: string; resolutionLabel?: string; isOriginal?: boolean }
  ): Promise<void> => {
    const downloadId = `${ratingKey}-${partKey}-${Date.now()}`;

    // Check if this is a bulk download (season or album ZIP)
    const isBulkDownload = partKey.includes('/season/') || partKey.includes('/album/');

    // Check if this is a transcoded download (non-original resolution)
    const isTranscoded = !!(options?.resolutionId && !options?.isOriginal);

    // Add download to state
    const newDownload: Download = {
      id: downloadId,
      ratingKey,
      partKey,
      filename,
      title: options?.resolutionLabel ? `${title} [${options.resolutionLabel}]` : title,
      progress: 0,
      status: 'downloading',
      isBulkDownload,
      isTranscoded,
      resolution: options?.resolutionLabel,
    };

    setDownloads((prev) => [...prev, newDownload]);

    try {
      // Determine the download URL based on download type
      let downloadUrl: string;

      if (partKey.startsWith('/api/')) {
        // Already a full URL for bulk downloads
        downloadUrl = partKey;
      } else if (isTranscoded && options?.resolutionId) {
        // Use transcode endpoint for non-original resolution
        downloadUrl = api.getTranscodeDownloadUrl(ratingKey, options.resolutionId);
      } else {
        // Regular direct file download
        downloadUrl = api.getDownloadUrl(ratingKey, partKey);
      }

      // Fetch with progress tracking
      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        // Try to extract error message from JSON response
        let errorMessage = 'Download failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // For transcoded downloads, get cache key and start polling
      if (isTranscoded) {
        const cacheKey = response.headers.get('X-Transcode-Cache-Key');
        if (cacheKey) {
          // Update download with cache key
          setDownloads((prev) =>
            prev.map((d) =>
              d.id === downloadId
                ? { ...d, transcodeCacheKey: cacheKey }
                : d
            )
          );
          // Start polling for progress
          startProgressPolling(downloadId, cacheKey);
        }
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Stream not available');
      }

      const chunks: Uint8Array[] = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        // Update progress for non-bulk, non-transcoded downloads with known size
        // Transcoded downloads get progress from polling
        if (!isBulkDownload && !isTranscoded && total > 0) {
          const progress = Math.round((receivedLength / total) * 100);
          setDownloads((prev) =>
            prev.map((d) =>
              d.id === downloadId
                ? { ...d, progress }
                : d
            )
          );
        }
      }

      // Stop polling if it was a transcode
      stopProgressPolling(downloadId);

      // Create blob and download
      const blob = new Blob(chunks as BlobPart[]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Mark as completed
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === downloadId
            ? { ...d, status: 'completed', progress: 100 }
            : d
        )
      );

      // Remove after 3 seconds
      setTimeout(() => {
        setDownloads((prev) => prev.filter((d) => d.id !== downloadId));
      }, 3000);
    } catch (error: any) {
      // Stop polling on error
      stopProgressPolling(downloadId);

      // Mark as error
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === downloadId
            ? { ...d, status: 'error', error: error.message }
            : d
        )
      );

      // Remove after 5 seconds
      setTimeout(() => {
        setDownloads((prev) => prev.filter((d) => d.id !== downloadId));
      }, 5000);
    }
  };

  const removeDownload = (id: string) => {
    stopProgressPolling(id);
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <DownloadContext.Provider value={{ downloads, startDownload, removeDownload }}>
      {children}
    </DownloadContext.Provider>
  );
};
