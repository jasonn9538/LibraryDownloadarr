import React, { useEffect, useRef } from 'react';
import { MediaItem } from '../types';
import { MediaCard } from './MediaCard';
import { useNavigate } from 'react-router-dom';

interface MediaGridProps {
  media: MediaItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isSelectionMode?: boolean;
  selectedItems?: Set<string>;
  onToggleSelect?: (ratingKey: string) => void;
}

export const MediaGrid: React.FC<MediaGridProps> = ({
  media,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  isSelectionMode = false,
  selectedItems,
  onToggleSelect,
}) => {
  const navigate = useNavigate();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => observer.disconnect();
  }, [onLoadMore, hasMore, isLoadingMore]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (media.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">No media found</div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
        {media.map((item) => (
          <MediaCard
            key={item.ratingKey}
            media={item}
            onClick={() => navigate(`/media/${item.ratingKey}`)}
            isSelectionMode={isSelectionMode}
            isSelected={selectedItems?.has(item.ratingKey) ?? false}
            onToggleSelect={() => onToggleSelect?.(item.ratingKey)}
          />
        ))}
      </div>

      {/* Sentinel element for infinite scroll */}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-8">
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-gray-400">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Loading more...</span>
            </div>
          )}
        </div>
      )}
    </>
  );
};
