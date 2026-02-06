import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { MediaGrid } from '../components/MediaGrid';
import { api } from '../services/api';
import { MediaItem, Library } from '../types';
import { useMobileMenu } from '../hooks/useMobileMenu';

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

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortIndex(parseInt(e.target.value, 10));
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
          />
        </main>
      </div>
    </div>
  );
};
