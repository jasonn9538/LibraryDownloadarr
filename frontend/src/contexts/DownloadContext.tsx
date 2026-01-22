import React, { createContext, useContext, useState, ReactNode } from 'react';
import { api } from '../services/api';

interface Download {
  id: string;
  filename: string;
  title: string;
  status: 'started' | 'error';
  error?: string;
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

  const startDownload = async (
    ratingKey: string,
    partKey: string,
    filename: string,
    title: string,
    options?: { resolutionId?: string; resolutionLabel?: string; isOriginal?: boolean }
  ): Promise<void> => {
    const downloadId = `${ratingKey}-${Date.now()}`;

    // For transcoded (non-original) downloads, this shouldn't be called anymore
    // since we queue them instead. But keep the check just in case.
    if (options?.resolutionId && !options?.isOriginal) {
      console.warn('Transcoded downloads should use the queue system');
      return;
    }

    // Add download notification
    const newDownload: Download = {
      id: downloadId,
      filename,
      title: options?.resolutionLabel ? `${title} [${options.resolutionLabel}]` : title,
      status: 'started',
    };

    setDownloads((prev) => [...prev, newDownload]);

    try {
      // Determine the download URL
      let downloadUrl: string;

      if (partKey.startsWith('/api/')) {
        // Already a full URL for bulk downloads (season/album zips)
        // Add token if not already present
        if (!partKey.includes('token=')) {
          const token = localStorage.getItem('token');
          downloadUrl = partKey + (partKey.includes('?') ? '&' : '?') + `token=${token}`;
        } else {
          downloadUrl = partKey;
        }
      } else {
        // Regular direct file download - token is already included by api.getDownloadUrl
        downloadUrl = api.getDownloadUrl(ratingKey, partKey);
      }

      // Use an invisible iframe to trigger the download
      // This lets the browser's download manager handle it properly
      // without navigating away from the current page
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = downloadUrl;
      document.body.appendChild(iframe);

      // Clean up iframe after a delay (download should have started by then)
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 5000);

      // Remove the notification after 3 seconds
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
