import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';

export interface ResolutionOption {
  id: string;
  label: string;
  height: number;
  width: number;
  isOriginal: boolean;
  bitrate?: number;
  codec?: string;
  container?: string;
  fileSize?: number;
  maxVideoBitrate?: number;
  estimatedSize?: number;
  // Transcode status (populated by ResolutionSelector if available)
  transcodeStatus?: 'pending' | 'transcoding' | 'completed';
  transcodeJobId?: string;
}

interface TranscodeStatus {
  status: 'pending' | 'transcoding' | 'completed';
  progress?: number;
  jobId?: string;
}

interface ResolutionSelectorProps {
  ratingKey: string;
  onSelect: (resolution: ResolutionOption) => void;
  onCancel: () => void;
  isOpen: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement>;
}

export const ResolutionSelector: React.FC<ResolutionSelectorProps> = ({
  ratingKey,
  onSelect,
  onCancel,
  isOpen,
  buttonRef,
}) => {
  const [resolutions, setResolutions] = useState<ResolutionOption[]>([]);
  const [transcodeStatuses, setTranscodeStatuses] = useState<Map<string, TranscodeStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate position based on button location and viewport
  useEffect(() => {
    if (isOpen && buttonRef?.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 280;
      const headerHeight = 60; // Approximate header height
      const footerHeight = 50; // Approximate footer/cancel button height
      const padding = 16; // Padding from viewport edges

      // Calculate available space below and above the button
      const spaceBelow = window.innerHeight - rect.bottom - padding;
      const spaceAbove = rect.top - padding;

      // Determine if we should show above or below
      const minHeight = 200; // Minimum usable height
      let top: number;
      let maxHeight: number;

      if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
        // Show below the button
        top = rect.bottom + 8;
        maxHeight = Math.min(400, spaceBelow - 8);
      } else {
        // Show above the button
        maxHeight = Math.min(400, spaceAbove - 8);
        top = rect.top - maxHeight - headerHeight - footerHeight - 8;
      }

      // Ensure minimum height
      maxHeight = Math.max(minHeight, maxHeight);

      // Calculate horizontal position
      let left = rect.right - dropdownWidth;

      // Ensure dropdown doesn't go off the left edge
      if (left < padding) {
        left = padding;
      }

      // Ensure dropdown doesn't go off the right edge
      if (left + dropdownWidth > window.innerWidth - padding) {
        left = window.innerWidth - dropdownWidth - padding;
      }

      setPosition({ top, left, maxHeight });
    }
  }, [isOpen, buttonRef]);

  useEffect(() => {
    if (isOpen) {
      loadResolutions();
    }
  }, [isOpen, ratingKey]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef?.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        onCancel();
      }
    };

    // Close on scroll - but NOT if scrolling inside the dropdown
    const handleScroll = (event: Event) => {
      if (isOpen) {
        // Don't close if scrolling inside the dropdown
        if (dropdownRef.current?.contains(event.target as Node)) {
          return;
        }
        onCancel();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onCancel, buttonRef]);

  const loadResolutions = async () => {
    setIsLoading(true);
    setError('');

    try {
      // Load both resolution options and available transcodes in parallel
      const [resolutionResponse, transcodes] = await Promise.all([
        api.getResolutionOptions(ratingKey),
        api.getTranscodesForMedia(ratingKey),
      ]);

      setResolutions(resolutionResponse.resolutions);

      // Build a map of resolutionId -> transcode status
      const statusMap = new Map<string, TranscodeStatus>();
      for (const job of transcodes) {
        // Only store the most relevant status for each resolution
        const existing = statusMap.get(job.resolutionId);
        if (!existing ||
            (job.status === 'completed' && existing.status !== 'completed') ||
            (job.status === 'transcoding' && existing.status === 'pending')) {
          statusMap.set(job.resolutionId, {
            status: job.status as 'pending' | 'transcoding' | 'completed',
            progress: job.progress,
            jobId: job.id,
          });
        }
      }
      setTranscodeStatuses(statusMap);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load resolution options');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  const dropdown = (
    <div
      ref={dropdownRef}
      className="fixed z-[9999] bg-dark-100 border border-dark-50 rounded-lg shadow-xl min-w-[280px] max-w-[calc(100vw-32px)] flex flex-col"
      style={{
        top: position.top,
        left: position.left,
        maxHeight: position.maxHeight,
      }}
    >
      <div className="p-3 border-b border-dark-50 bg-dark-200 flex-shrink-0">
        <h3 className="text-sm font-semibold text-white">Select Resolution</h3>
        <p className="text-xs text-gray-400 mt-1">Choose download resolution</p>
      </div>

      {isLoading ? (
        <div className="p-4 text-center text-gray-400 flex-shrink-0">
          <div className="animate-spin inline-block w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full mb-2" />
          <p className="text-sm">Loading options...</p>
        </div>
      ) : error ? (
        <div className="p-4 text-center text-red-400 flex-shrink-0">
          <p className="text-sm">{error}</p>
          <button
            onClick={loadResolutions}
            className="mt-2 text-xs text-primary-500 hover:text-primary-400"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {resolutions.map((resolution, index) => {
            const transcodeStatus = transcodeStatuses.get(resolution.id);
            const resolutionWithStatus: ResolutionOption = {
              ...resolution,
              transcodeStatus: transcodeStatus?.status,
              transcodeJobId: transcodeStatus?.jobId,
            };
            return (
            <button
              key={resolution.id}
              onClick={() => onSelect(resolutionWithStatus)}
              className={`w-full px-4 py-3 text-left hover:bg-dark-200 transition-colors flex items-center justify-between group ${
                index !== resolutions.length - 1 ? 'border-b border-dark-50' : ''
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white group-hover:text-primary-500">
                    {resolution.label}
                  </span>
                  {resolution.isOriginal && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-primary-500/20 text-primary-400 rounded">
                      ORIGINAL
                    </span>
                  )}
                  {resolution.height === 720 && !resolution.isOriginal && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">
                      Best for mobile
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {resolution.isOriginal ? (
                    <>
                      {resolution.codec?.toUpperCase()} • {resolution.container?.toUpperCase()}
                      {resolution.bitrate && ` • ${Math.round(resolution.bitrate / 1000)} Mbps`}
                    </>
                  ) : (
                    <>
                      {resolution.width}x{resolution.height} • H264 • MP4
                      {resolution.maxVideoBitrate && ` • ~${Math.round(resolution.maxVideoBitrate / 1000)} Mbps`}
                    </>
                  )}
                </div>
                {!resolution.isOriginal && (
                  <div className="text-xs mt-1">
                    {(() => {
                      const transcodeStatus = transcodeStatuses.get(resolution.id);
                      if (transcodeStatus?.status === 'completed') {
                        return <span className="text-green-400">✅ Ready to download</span>;
                      } else if (transcodeStatus?.status === 'transcoding') {
                        return <span className="text-blue-400">⚙️ Transcoding... {transcodeStatus.progress}%</span>;
                      } else if (transcodeStatus?.status === 'pending') {
                        return <span className="text-yellow-400">⏳ Queued for transcoding</span>;
                      } else {
                        return <span className="text-gray-400">⚙️ Requires transcoding</span>;
                      }
                    })()}
                  </div>
                )}
              </div>
              <div className="text-right">
                {resolution.isOriginal && resolution.fileSize ? (
                  <span className="text-xs text-gray-400">
                    {formatFileSize(resolution.fileSize)}
                  </span>
                ) : resolution.estimatedSize ? (
                  <span className="text-xs text-gray-500">
                    ~{formatFileSize(resolution.estimatedSize)}
                  </span>
                ) : null}
              </div>
            </button>
            );
          })}
        </div>
      )}

      <div className="p-2 border-t border-dark-50 bg-dark-200 flex-shrink-0">
        <button
          onClick={onCancel}
          className="w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // Use portal to render at document body level to avoid overflow clipping
  return createPortal(dropdown, document.body);
};
