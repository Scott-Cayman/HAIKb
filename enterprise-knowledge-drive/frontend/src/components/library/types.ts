import type { MouseEvent, ReactNode } from 'react';
import type { MovableResource } from '../../services/resourceMove';

export type CollectionViewMode = 'list' | 'grid';

export type CollectionStatusTone = 'success' | 'warning' | 'neutral';

export type CollectionFavoriteAction = {
  active: boolean;
  title: string;
  onClick: () => void;
};

export type CollectionPrimaryAction = {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export type CollectionFolderLink = {
  label: string;
  title?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export type CollectionItem = {
  kind: 'file' | 'folder';
  id: number | string;
  name: string;
  onOpen: () => void;
  description?: string | null;
  secondaryLabel?: string | null;
  secondaryTitle?: string | null;
  sizeLabel?: string | null;
  dateLabel?: string | null;
  statusLabel?: string | null;
  statusTone?: CollectionStatusTone;
  folderLink?: CollectionFolderLink | null;
  favorite?: CollectionFavoriteAction | null;
  action?: CollectionPrimaryAction | null;
  menu?: ReactNode;
  previewStatus?: string | null;
  thumbnailStatus?: string | null;
  fileExt?: string | null;
  iconKey?: string | null;
  iconBgFrom?: string | null;
  iconBgTo?: string | null;
  iconColor?: string | null;
  move?: {
    resource: MovableResource;
    enabled: boolean;
    canAcceptDrop?: boolean;
    onDrop?: (resource: MovableResource, targetFolderId: number) => void;
  };
};
