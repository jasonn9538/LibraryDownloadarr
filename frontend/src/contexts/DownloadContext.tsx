import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  isTranscoded?: boolean; // True for transcoded downloads (no Content-Length)
  quality?: string; // Quality label for display
}

interface DownloadContextType {
  downloads: Download[];
  startDownload: (
    ratingKey: string,
    partKey: string,
    filename: string,
    title: string,
    options?: { qualityId?: string; qualityLabel?: string; isOriginal?: boolean }
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

  // Warn user before closing/refreshing if downloads are in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const activeDownloads = downloads.filter(d => d.status === 'downloading');

      if (activeDownloads.length > 0) {
        // Standard way to show browser confirmation dialog
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [downloads]);

  const startDownload = async (
    ratingKey: string,
    partKey: string,
    filename: string,
    title: string,
    options?: { qualityId?: string; qualityLabel?: string; isOriginal?: boolean }
  ): Promise<void> => {
    const downloadId = `${ratingKey}-${partKey}-${Date.now()}`;

    // Check if this is a bulk download (season or album ZIP)
    const isBulkDownload = partKey.includes('/season/') || partKey.includes('/album/');

    // Check if this is a transcoded download (non-original quality)
    const isTranscoded = !!(options?.qualityId && !options?.isOriginal);

    // Add download to state
    const newDownload: Download = {
      id: downloadId,
      ratingKey,
      partKey,
      filename,
      title: options?.qualityLabel ? `${title} [${options.qualityLabel}]` : title,
      progress: 0,
      status: 'downloading',
      isBulkDownload,
      isTranscoded,
      quality: options?.qualityLabel,
    };

    setDownloads((prev) => [...prev, newDownload]);

    try {
      // Determine the download URL based on download type
      let downloadUrl: string;

      if (partKey.startsWith('/api/')) {
        // Already a full URL for bulk downloads
        downloadUrl = partKey;
      } else if (isTranscoded && options?.qualityId) {
        // Use transcode endpoint for non-original quality
        downloadUrl = api.getTranscodeDownloadUrl(ratingKey, options.qualityId);
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

        // Update progress - only for non-bulk, non-transcoded downloads with known size
        // Bulk downloads (zips) and transcoded downloads don't have Content-Length
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
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <DownloadContext.Provider value={{ downloads, startDownload, removeDownload }}>
      {children}
    </DownloadContext.Provider>
  );
};
