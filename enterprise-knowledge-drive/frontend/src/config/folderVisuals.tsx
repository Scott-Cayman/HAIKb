import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Box,
  Briefcase,
  Folder,
  FolderKanban,
  GraduationCap,
  Lightbulb,
  Rocket,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

import { BACKEND_BASE_URL } from '../services/backendConfig';

export type FolderDisplayMode = 'icon' | 'cover';

export type FolderVisualConfig = {
  display_mode?: FolderDisplayMode | null;
  cover_url?: string | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  card_bg_from?: string | null;
  card_bg_via?: string | null;
  card_bg_to?: string | null;
  card_glow_color?: string | null;
};

export type FolderIconOption = {
  key: string;
  label: string;
  icon: LucideIcon;
};

export const folderIconOptions: FolderIconOption[] = [
  { key: 'folder', label: '云盘文件夹', icon: Folder },
  { key: 'book-open', label: '学习资料', icon: BookOpen },
  { key: 'graduation-cap', label: '培训成长', icon: GraduationCap },
  { key: 'briefcase', label: '业务资料', icon: Briefcase },
  { key: 'folder-kanban', label: '项目管理', icon: FolderKanban },
  { key: 'target', label: '目标计划', icon: Target },
  { key: 'users', label: '团队协作', icon: Users },
  { key: 'lightbulb', label: '创意灵感', icon: Lightbulb },
  { key: 'rocket', label: '创新推进', icon: Rocket },
  { key: 'sparkles', label: '品牌专题', icon: Sparkles },
  { key: 'box', label: '资料归档', icon: Box },
];

const iconMap = new Map(folderIconOptions.map((item) => [item.key, item.icon]));

export const getFolderIconComponent = (iconKey?: string | null): LucideIcon =>
  iconMap.get(iconKey || '') || Folder;

export const getFolderVisualConfig = (folder?: FolderVisualConfig | null) => ({
  displayMode: (folder?.display_mode || 'icon') as FolderDisplayMode,
  coverUrl: folder?.cover_url || '',
  iconKey: folder?.icon_key || 'folder',
  iconBgFrom: folder?.icon_bg_from || '#8cf3d5',
  iconBgTo: folder?.icon_bg_to || '#44d7cc',
  iconColor: folder?.icon_color || '#ffffff',
  cardBgFrom: folder?.card_bg_from || '#ebfff7',
  cardBgVia: folder?.card_bg_via || '#d8fff3',
  cardBgTo: folder?.card_bg_to || '#c1f7ec',
  cardGlowColor: folder?.card_glow_color || '#ffffff',
});

export const resolveAssetUrl = (url?: string | null) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || !url.startsWith('/')) {
    return url;
  }
  return BACKEND_BASE_URL ? `${BACKEND_BASE_URL}${url}` : url;
};
