import { useCallback, useState } from 'react';

import type { CollectionViewMode } from '../components/library/types';

const KNOWLEDGE_VIEW_MODE_STORAGE_KEY = 'haikb:knowledge-view-mode:v1';

const readInitialViewMode = (): CollectionViewMode => {
  if (typeof window === 'undefined') return 'grid';
  try {
    const storedMode = window.localStorage.getItem(KNOWLEDGE_VIEW_MODE_STORAGE_KEY);
    return storedMode === 'list' || storedMode === 'grid' ? storedMode : 'grid';
  } catch {
    return 'grid';
  }
};

export const useKnowledgeViewMode = () => {
  const [viewMode, setViewModeState] = useState<CollectionViewMode>(readInitialViewMode);

  const setViewMode = useCallback((mode: CollectionViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage.setItem(KNOWLEDGE_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Private browsing or storage policies may disable localStorage.
    }
  }, []);

  return [viewMode, setViewMode] as const;
};
