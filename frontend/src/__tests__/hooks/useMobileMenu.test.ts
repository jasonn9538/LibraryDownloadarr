import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMobileMenu } from '../../hooks/useMobileMenu';

describe('useMobileMenu', () => {
  it('starts with menu closed', () => {
    const { result } = renderHook(() => useMobileMenu());
    expect(result.current.isMobileMenuOpen).toBe(false);
  });

  it('toggles menu open and closed', () => {
    const { result } = renderHook(() => useMobileMenu());

    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(true);

    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(false);
  });

  it('closeMobileMenu sets menu to closed', () => {
    const { result } = renderHook(() => useMobileMenu());

    // Open it first
    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(true);

    // Close it
    act(() => {
      result.current.closeMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(false);
  });

  it('closes menu on window resize to desktop width', () => {
    const { result } = renderHook(() => useMobileMenu());

    // Open menu
    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(true);

    // Simulate resize to desktop
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.isMobileMenuOpen).toBe(false);
  });

  it('keeps menu open on resize below 768px', () => {
    const { result } = renderHook(() => useMobileMenu());

    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(true);

    // Simulate resize but still mobile
    Object.defineProperty(window, 'innerWidth', { value: 600, writable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.isMobileMenuOpen).toBe(true);
  });

  it('cleans up resize listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useMobileMenu());

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
