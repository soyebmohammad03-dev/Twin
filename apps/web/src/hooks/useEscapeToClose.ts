import { useEffect } from 'react';

/** Closes the calling modal/drawer on Escape — shared so every dismissible surface behaves consistently instead of each one reimplementing (or forgetting) the same listener. */
export function useEscapeToClose(onClose: () => void, isActive: boolean = true): void {
  useEffect(() => {
    if (!isActive) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isActive]);
}
