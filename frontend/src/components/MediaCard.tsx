import React from 'react';
import { MediaItem } from '../types';
import { api } from '../services/api';

interface MediaCardProps {
  media: MediaItem;
  onClick: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  onClick,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const thumbnailUrl = media.thumb ? api.getThumbnailUrl(media.ratingKey, media.thumb) : null;

  // Format display info based on media type
  const getDisplayInfo = () => {
    if (media.type === 'episode') {
      // Show: Show Name
      // Subtitle: S##E## - Episode Title (or just E## if no season number)
      const showName = media.grandparentTitle || 'Unknown Show';
      const seasonNum = media.parentIndex ? `S${String(media.parentIndex).padStart(2, '0')}` : '';
      const episodeNum = media.index ? `E${String(media.index).padStart(2, '0')}` : '';
      const episodeInfo = seasonNum ? `${seasonNum}${episodeNum}` : episodeNum;
      const subtitle = episodeInfo ? `${episodeInfo} - ${media.title}` : media.title;

      return {
        title: showName,
        subtitle,
        meta: media.parentTitle || null, // Season name
      };
    }

    if (media.type === 'track') {
      // Show: Album Name
      // Subtitle: Track Title
      const albumName = media.parentTitle || 'Unknown Album';
      return {
        title: albumName,
        subtitle: media.title,
        meta: media.grandparentTitle || null, // Artist name
      };
    }

    // For movies, shows, seasons, albums - show normally
    return {
      title: media.title,
      subtitle: null,
      meta: media.year?.toString() || null,
    };
  };

  const { title, subtitle, meta } = getDisplayInfo();

  const handleClick = () => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect();
    } else {
      onClick();
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`card cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl group ${
        isSelected ? 'ring-2 ring-primary-500' : ''
      }`}
    >
      <div className="relative aspect-[2/3] bg-dark-200">
        {/* Selection checkbox */}
        {isSelectionMode && (
          <div className="absolute top-2 right-2 z-10">
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
              isSelected
                ? 'bg-primary-500 border-primary-500'
                : 'bg-dark-100/80 border-gray-400 hover:border-primary-500'
            }`}>
              {isSelected && (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        )}
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={media.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <span className="text-4xl">{media.type === 'movie' ? '🎬' : '📺'}</span>
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <h3 className="font-semibold text-sm line-clamp-2 mb-1">{title}</h3>
          {subtitle && <p className="text-xs text-gray-300 line-clamp-2">{subtitle}</p>}
          {meta && <p className="text-xs text-gray-400 mt-1">{meta}</p>}
          {media.contentRating && (
            <span className="text-xs text-gray-400 mt-1">{media.contentRating}</span>
          )}
        </div>
      </div>

      {/* Title below card (always visible) */}
      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{subtitle}</p>}
        {!subtitle && meta && <p className="text-xs text-gray-400 mt-1">{meta}</p>}
      </div>
    </div>
  );
};
