import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaItem } from '../types';
import { MediaCard } from './MediaCard';

interface HubRowProps {
  title: string;
  items: MediaItem[];
  isLoading?: boolean;
}

export const HubRow: React.FC<HubRowProps> = ({ title, items, isLoading }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const navigate = useNavigate();

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, [items]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (!isLoading && items.length === 0) return null;

  if (isLoading) {
    return (
      <div className="mb-6 md:mb-8">
        <div className="h-7 w-48 bg-dark-200 rounded animate-pulse mb-3" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-36 md:w-44 flex-shrink-0">
              <div className="aspect-[2/3] bg-dark-200 rounded-lg animate-pulse" />
              <div className="h-4 bg-dark-200 rounded mt-2 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 md:mb-8 group/hub relative">
      <h3 className="text-lg md:text-xl font-bold mb-3">{title}</h3>
      <div className="relative">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-r from-dark-100/90 to-transparent
              flex items-center justify-center opacity-0 group-hover/hub:opacity-100 transition-opacity cursor-pointer"
            aria-label="Scroll left"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Scrollable container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory
            [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <div key={item.ratingKey} className="w-36 md:w-44 flex-shrink-0 snap-start">
              <MediaCard
                media={item}
                onClick={() => navigate(`/media/${item.ratingKey}`)}
              />
            </div>
          ))}
        </div>

        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-l from-dark-100/90 to-transparent
              flex items-center justify-center opacity-0 group-hover/hub:opacity-100 transition-opacity cursor-pointer"
            aria-label="Scroll right"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
