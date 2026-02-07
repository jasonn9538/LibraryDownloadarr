import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { MediaGrid } from '../components/MediaGrid';
import { BatchTranscodeBar } from '../components/BatchTranscodeBar';
import { api } from '../services/api';
import { MediaItem, Library } from '../types';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { useAuthStore } from '../stores/authStore';

interface SortOption {
  value: string;
  label: string;
  order: 'asc' | 'desc';
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'titleSort', label: 'Title (A-Z)', order: 'asc' },
  { value: 'titleSort', label: 'Title (Z-A)', order: 'desc' },
  { value: 'year', label: 'Year (Newest)', order: 'desc' },
  { value: 'year', label: 'Year (Oldest)', order: 'asc' },
  { value: 'addedAt', label: 'Date Added (Newest)', order: 'desc' },
  { value: 'addedAt', label: 'Date Added (Oldest)', order: 'asc' },
  { value: 'rating', label: 'Rating (Highest)', order: 'desc' },
  { value: 'rating', label: 'Rating (Lowest)', order: 'asc' },
];

const ITEMS_PER_PAGE = 50;

export const LibraryView: React.FC = () => {
  const { libraryKey } = useParams<{ libraryKey: string }>();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortIndex, setSortIndex] = useState(0);
  const [viewType, setViewType] = useState<string | undefined>(undefined);
  const [currentLibrary, setCurrentLibrary] = useState<Library | null>(null);
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Selection mode state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [batchToast, setBatchToast] = useState<{ successCount: number; totalCount: number } | null>(null);

  const currentSort = SORT_OPTIONS[sortIndex];

  // Initial load when library key or sort changes
  useEffect(() => {
    if (libraryKey) {
      loadLibraryContent(true);
    }
  }, [libraryKey, sortIndex]);

  const loadLibraryContent = async (reset: boolean = false) => {
    if (!libraryKey) return;

    if (reset) {
      setIsLoading(true);
      setMedia([]);
      setOffset(0);
    }
    setError('');

    try {
      // Get library info first to determine the type (only on initial load)
      let libViewType = viewType;
      if (reset) {
        const libraries = await api.getLibraries();
        const lib = libraries.find((l) => l.key === libraryKey);
        setCurrentLibrary(lib || null);
        libViewType = lib?.type === 'artist' ? 'albums' : undefined;
        setViewType(libViewType);
      }

      const result = await api.getLibraryContent(libraryKey, {
        viewType: libViewType,
        offset: 0,
        limit: ITEMS_PER_PAGE,
        sort: currentSort.value,
        order: currentSort.order,
      });

      setMedia(result.content);
      setTotalSize(result.totalSize);
      setHasMore(result.hasMore);
      setOffset(result.content.length);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load library content');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!libraryKey || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);

    try {
      const result = await api.getLibraryContent(libraryKey, {
        viewType,
        offset,
        limit: ITEMS_PER_PAGE,
        sort: currentSort.value,
        order: currentSort.order,
      });

      setMedia((prev) => [...prev, ...result.content]);
      setHasMore(result.hasMore);
      setOffset((prev) => prev + result.content.length);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load more content');
    } finally {
      setIsLoadingMore(false);
    }
  }, [libraryKey, isLoadingMore, hasMore, offset, viewType, currentSort]);

  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev);
    setSelectedItems(new Set());
  };

  const toggleItemSelection = (ratingKey: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(ratingKey)) next.delete(ratingKey);
      else next.add(ratingKey);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedItems(new Set(media.map((item) => item.ratingKey)));
  };

  const handleBatchSuccess = (successCount: number, totalCount: number) => {
    setBatchToast({ successCount, totalCount });
    setSelectedItems(new Set());
    setIsSelectionMode(false);
    setTimeout(() => setBatchToast(null), 5000);
    setTimeout(() => navigate('/transcodes'), 1000);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortIndex(parseInt(e.target.value, 10));
    setSelectedItems(new Set());
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 md:px-4 py-2 md:py-3 rounded-lg mb-4 md:mb-6 text-sm md:text-base">
              {error}
            </div>
          )}

          {/* Header with title, count, and sort controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
            <div className="flex items-center gap-3">
              {currentLibrary && (
                <h1 className="text-xl md:text-2xl font-bold text-white">
                  {currentLibrary.title}
                </h1>
              )}
              {!isLoading && totalSize > 0 && (
                <span className="text-sm text-gray-400">
                  {totalSize.toLocaleString()} {totalSize === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Selection mode toggle (admin only, movie/show libraries) */}
              {user?.isAdmin && currentLibrary && (currentLibrary.type === 'movie' || currentLibrary.type === 'show') && (
                <button
                  onClick={toggleSelectionMode}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isSelectionMode
                      ? 'bg-primary-500 text-white'
                      : 'bg-dark-100 border border-dark-50 text-gray-300 hover:bg-dark-200'
                  }`}
                >
                  {isSelectionMode ? 'Cancel' : 'Select'}
                </button>
              )}
              {isSelectionMode && (
                <button
                  onClick={selectAll}
                  className="px-3 py-2 bg-dark-100 border border-dark-50 text-gray-300 hover:bg-dark-200 rounded-lg text-sm"
                >
                  Select All
                </button>
              )}
              <label htmlFor="sort-select" className="text-sm text-gray-400">
                Sort by:
              </label>
              <select
                id="sort-select"
                value={sortIndex}
                onChange={handleSortChange}
                className="bg-dark-100 border border-dark-50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {SORT_OPTIONS.map((option, index) => (
                  <option key={`${option.value}-${option.order}`} value={index}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <MediaGrid
            media={media}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            isSelectionMode={isSelectionMode}
            selectedItems={selectedItems}
            onToggleSelect={toggleItemSelection}
          />

          {/* Batch transcode bar */}
          {isSelectionMode && selectedItems.size > 0 && (
            <BatchTranscodeBar
              selectedCount={selectedItems.size}
              selectedRatingKeys={Array.from(selectedItems)}
              onCancel={toggleSelectionMode}
              onSuccess={handleBatchSuccess}
            />
          )}

          {/* Batch success toast */}
          {batchToast && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-green-600/90 text-white px-6 py-3 rounded-lg shadow-lg">
              <div className="font-medium">
                {batchToast.successCount} of {batchToast.totalCount} transcodes queued
              </div>
              <div className="text-sm text-green-100">Redirecting to Transcodes page...</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
