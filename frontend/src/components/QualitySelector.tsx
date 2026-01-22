import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';

export interface QualityOption {
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

interface QualitySelectorProps {
  ratingKey: string;
  onSelect: (quality: QualityOption) => void;
  onCancel: () => void;
  isOpen: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement>;
}

export const QualitySelector: React.FC<QualitySelectorProps> = ({
  ratingKey,
  onSelect,
  onCancel,
  isOpen,
  buttonRef,
}) => {
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadQualities();
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

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onCancel, buttonRef]);

  const loadQualities = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await api.getQualityOptions(ratingKey);
      setQualities(response.qualities);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load quality options');
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

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 z-50 bg-dark-100 border border-dark-50 rounded-lg shadow-xl min-w-[280px] overflow-hidden"
    >
      <div className="p-3 border-b border-dark-50 bg-dark-200">
        <h3 className="text-sm font-semibold text-white">Select Quality</h3>
        <p className="text-xs text-gray-400 mt-1">Choose download quality</p>
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
            onClick={loadQualities}
            className="mt-2 text-xs text-primary-500 hover:text-primary-400"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          {qualities.map((quality, index) => (
            <button
              key={quality.id}
              onClick={() => onSelect(quality)}
              className={`w-full px-4 py-3 text-left hover:bg-dark-200 transition-colors flex items-center justify-between group ${
                index !== qualities.length - 1 ? 'border-b border-dark-50' : ''
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white group-hover:text-primary-500">
                    {quality.label}
                  </span>
                  {quality.isOriginal && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-primary-500/20 text-primary-400 rounded">
                      ORIGINAL
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {quality.isOriginal ? (
                    <>
                      {quality.codec?.toUpperCase()} • {quality.container?.toUpperCase()}
                      {quality.bitrate && ` • ${Math.round(quality.bitrate / 1000)} Mbps`}
                    </>
                  ) : (
                    <>
                      {quality.width}x{quality.height} • H264 • MP4
                      {quality.maxVideoBitrate && ` • ~${Math.round(quality.maxVideoBitrate / 1000)} Mbps`}
                    </>
                  )}
                </div>
              </div>
              <div className="text-right">
                {quality.isOriginal && quality.fileSize ? (
                  <span className="text-xs text-gray-400">
                    {formatFileSize(quality.fileSize)}
                  </span>
                ) : quality.estimatedSize ? (
                  <span className="text-xs text-gray-500">
                    ~{formatFileSize(quality.estimatedSize)}
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
};
