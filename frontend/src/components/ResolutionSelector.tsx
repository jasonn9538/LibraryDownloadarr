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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate position based on button location
  useEffect(() => {
    if (isOpen && buttonRef?.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 280;

      // Position below the button, aligned to the right edge
      let left = rect.right - dropdownWidth;
      const top = rect.bottom + 8; // 8px gap

      // Ensure dropdown doesn't go off the left edge
      if (left < 8) {
        left = 8;
      }

      // Ensure dropdown doesn't go off the right edge
      if (left + dropdownWidth > window.innerWidth - 8) {
        left = window.innerWidth - dropdownWidth - 8;
      }

      setPosition({ top, left });
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

    // Close on scroll
    const handleScroll = () => {
      if (isOpen) {
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
      const response = await api.getResolutionOptions(ratingKey);
      setResolutions(response.resolutions);
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
      className="fixed z-[9999] bg-dark-100 border border-dark-50 rounded-lg shadow-xl min-w-[280px] overflow-hidden"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <div className="p-3 border-b border-dark-50 bg-dark-200">
        <h3 className="text-sm font-semibold text-white">Select Resolution</h3>
        <p className="text-xs text-gray-400 mt-1">Choose download resolution</p>
      </div>

      {isLoading ? (
        <div className="p-4 text-center text-gray-400">
          <div className="animate-spin inline-block w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full mb-2" />
          <p className="text-sm">Loading options...</p>
        </div>
      ) : error ? (
        <div className="p-4 text-center text-red-400">
          <p className="text-sm">{error}</p>
          <button
            onClick={loadResolutions}
            className="mt-2 text-xs text-primary-500 hover:text-primary-400"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          {resolutions.map((resolution, index) => (
            <button
              key={resolution.id}
              onClick={() => onSelect(resolution)}
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
          ))}
        </div>
      )}

      <div className="p-2 border-t border-dark-50 bg-dark-200">
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
