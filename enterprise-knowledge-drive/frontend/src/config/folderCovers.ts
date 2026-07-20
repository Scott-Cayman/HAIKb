import { defaultHomeAppearance, type PinnedFolderAppearance } from './homeAppearance';
import { getFolderVisualConfig, type FolderDisplayMode } from './folderVisuals';

export type FolderCoverConfig = {
  folderId?: number;
  folderName?: string;
  title: string;
  subtitle: string;
  statsLabel: string;
  imageUrl?: string;
  theme: PinnedFolderAppearance;
  displayMode: FolderDisplayMode;
  iconKey: string;
  iconBgFrom: string;
  iconBgTo: string;
  iconColor: string;
  cardBgFrom: string;
  cardBgVia: string;
  cardBgTo: string;
  cardGlowColor: string;
};

const folderCoverConfigs: FolderCoverConfig[] = [
  {
    folderName: '新人第一天',
    title: '新人第一天',
    subtitle: '新员工入职指引与必备资料',
    statsLabel: '57 个文件',
    theme: defaultHomeAppearance.folderCard,
    displayMode: 'icon',
    iconKey: 'book-open',
    iconBgFrom: '#8cf3d5',
    iconBgTo: '#44d7cc',
    iconColor: '#ffffff',
    cardBgFrom: '#ebfff7',
    cardBgVia: '#d8fff3',
    cardBgTo: '#c1f7ec',
    cardGlowColor: '#ffffff',
  },
  {
    folderName: '新人学习库',
    title: '新人学习库',
    subtitle: '学习资料与成长路径',
    statsLabel: '128 个文件',
    theme: defaultHomeAppearance.folderCard,
    displayMode: 'icon',
    iconKey: 'graduation-cap',
    iconBgFrom: '#8cf3d5',
    iconBgTo: '#44d7cc',
    iconColor: '#ffffff',
    cardBgFrom: '#ebfff7',
    cardBgVia: '#d8fff3',
    cardBgTo: '#c1f7ec',
    cardGlowColor: '#ffffff',
  },
  {
    folderName: '项目资料库',
    title: '项目资料库',
    subtitle: '项目文档与方案沉淀',
    statsLabel: '96 个文件',
    theme: defaultHomeAppearance.folderCard,
    displayMode: 'icon',
    iconKey: 'briefcase',
    iconBgFrom: '#8cf3d5',
    iconBgTo: '#44d7cc',
    iconColor: '#ffffff',
    cardBgFrom: '#ebfff7',
    cardBgVia: '#d8fff3',
    cardBgTo: '#c1f7ec',
    cardGlowColor: '#ffffff',
  },
];

export const getFolderCoverConfig = (
  folder: {
    id: number;
    name: string;
    description?: string;
    cover_url?: string | null;
    display_mode?: FolderDisplayMode | null;
    icon_key?: string | null;
    icon_bg_from?: string | null;
    icon_bg_to?: string | null;
    icon_color?: string | null;
    card_bg_from?: string | null;
    card_bg_via?: string | null;
    card_bg_to?: string | null;
    card_glow_color?: string | null;
  },
  theme: PinnedFolderAppearance = defaultHomeAppearance.folderCard,
) => {
  const matched =
    folderCoverConfigs.find((item) => item.folderId === folder.id) ||
    folderCoverConfigs.find((item) => item.folderName === folder.name);
  const visual = getFolderVisualConfig(folder);

  return {
    title: matched?.title || folder.name,
    subtitle: matched?.subtitle || folder.description || '沉淀团队文档与知识资产',
    statsLabel: matched?.statsLabel || '文件夹',
    imageUrl: folder.cover_url || matched?.imageUrl,
    theme,
    displayMode: visual.displayMode,
    iconKey: visual.iconKey,
    iconBgFrom: visual.iconBgFrom,
    iconBgTo: visual.iconBgTo,
    iconColor: visual.iconColor,
    cardBgFrom: visual.cardBgFrom,
    cardBgVia: visual.cardBgVia,
    cardBgTo: visual.cardBgTo,
    cardGlowColor: visual.cardGlowColor,
  };
};
