import React, { useState } from 'react';
import { api } from '../services/api';

const RESOLUTIONS = [
  { id: '4k', label: '4K (2160p)' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: '480p', label: '480p' },
  { id: '360p', label: '360p' },
];

interface BatchTranscodeBarProps {
  selectedCount: number;
  selectedRatingKeys: string[];
  onCancel: () => void;
  onSuccess: (successCount: number, totalCount: number) => void;
}

export const BatchTranscodeBar: React.FC<BatchTranscodeBarProps> = ({
  selectedCount,
  selectedRatingKeys,
  onCancel,
  onSuccess,
}) => {
  const [resolutionId, setResolutionId] = useState('720p');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleQueue = async () => {
    if (selectedRatingKeys.length === 0) return;
    setIsProcessing(true);
    setError('');

    try {
      const result = await api.queueBatchTranscode(selectedRatingKeys, resolutionId);
      onSuccess(result.successCount, result.totalCount);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to queue transcodes');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-dark-100 border-t border-dark-50 shadow-2xl z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <span className="text-sm text-gray-300 font-medium whitespace-nowrap">
            {selectedCount} selected
          </span>

          <div className="flex items-center gap-2 flex-1">
            <label htmlFor="batch-res" className="text-sm text-gray-400 whitespace-nowrap">
              Resolution:
            </label>
            <select
              id="batch-res"
              value={resolutionId}
              onChange={(e) => setResolutionId(e.target.value)}
              disabled={isProcessing}
              className="bg-dark-200 border border-dark-50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={isProcessing}
              className="flex-1 sm:flex-initial px-4 py-2 bg-dark-200 hover:bg-dark-50 rounded-lg transition-colors text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleQueue}
              disabled={isProcessing || selectedCount === 0}
              className="flex-1 sm:flex-initial px-6 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Queueing...' : `Queue ${selectedCount} Transcode${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
