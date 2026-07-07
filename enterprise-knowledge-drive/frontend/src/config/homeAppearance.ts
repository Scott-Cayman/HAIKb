export type GradientColors = {
  from: string;
  to: string;
  via?: string;
};

export type SurfaceColors = {
  bg: string;
  text: string;
  border?: string;
};

export type FolderCardAppearance = {
  gradient: GradientColors;
  glowColor: string;
  badge: SurfaceColors;
  iconGradient: GradientColors;
  iconColor: string;
};

export type HomeAppearanceConfig = {
  headerBadge: SurfaceColors;
  utilityButton: SurfaceColors & { hoverText: string };
  searchBox: Pick<SurfaceColors, 'bg' | 'border'>;
  aiButton: GradientColors & { text: string };
  keywordButton: SurfaceColors;
  folderCard: FolderCardAppearance;
  folderListIcon: GradientColors & { iconColor: string; hoverText: string };
  fileListIcon: GradientColors & { iconColor: string };
  folderLink: SurfaceColors;
  viewToggle: { trackBg: string; activeBg: string; activeText: string };
  previewButton: SurfaceColors;
};

export type HomeAppearanceConfigInput = Partial<{
  headerBadge: Partial<HomeAppearanceConfig['headerBadge']>;
  utilityButton: Partial<HomeAppearanceConfig['utilityButton']>;
  searchBox: Partial<HomeAppearanceConfig['searchBox']>;
  aiButton: Partial<HomeAppearanceConfig['aiButton']>;
  keywordButton: Partial<HomeAppearanceConfig['keywordButton']>;
  folderCard: Partial<{
    gradient: Partial<HomeAppearanceConfig['folderCard']['gradient']>;
    glowColor: string;
    badge: Partial<HomeAppearanceConfig['folderCard']['badge']>;
    iconGradient: Partial<HomeAppearanceConfig['folderCard']['iconGradient']>;
    iconColor: string;
  }>;
  folderListIcon: Partial<HomeAppearanceConfig['folderListIcon']>;
  fileListIcon: Partial<HomeAppearanceConfig['fileListIcon']>;
  folderLink: Partial<HomeAppearanceConfig['folderLink']>;
  viewToggle: Partial<HomeAppearanceConfig['viewToggle']>;
  previewButton: Partial<HomeAppearanceConfig['previewButton']>;
}>;

export const defaultHomeAppearance: HomeAppearanceConfig = {
  headerBadge: {
    bg: '#eefcf8',
    text: '#36b7a7',
  },
  utilityButton: {
    bg: '#ffffff',
    text: '#94a3b8',
    border: '#e2e8f0',
    hoverText: '#475569',
  },
  searchBox: {
    bg: '#ffffff',
    border: '#d9e8e4',
  },
  aiButton: {
    from: '#7df0cf',
    to: '#63c9ff',
    text: '#ffffff',
  },
  keywordButton: {
    bg: '#faf8f2',
    text: '#64748b',
  },
  folderCard: {
    gradient: {
      from: '#ebfff7',
      via: '#d8fff3',
      to: '#c1f7ec',
    },
    glowColor: '#ffffff',
    badge: {
      bg: '#ffffff',
      text: '#5e7d92',
    },
    iconGradient: {
      from: '#8cf3d5',
      to: '#44d7cc',
    },
    iconColor: '#ffffff',
  },
  folderListIcon: {
    from: '#d9fef2',
    to: '#daeaff',
    iconColor: '#3abdb1',
    hoverText: '#35b9ac',
  },
  fileListIcon: {
    from: '#ffe0a8',
    to: '#ffc0b0',
    iconColor: '#f08c38',
  },
  folderLink: {
    bg: '#f5fbfa',
    text: '#34b8aa',
  },
  viewToggle: {
    trackBg: '#f5fbfa',
    activeBg: '#ffffff',
    activeText: '#33beae',
  },
  previewButton: {
    bg: '#eefcf8',
    text: '#34b8aa',
  },
};

// 统一输出 CSS 渐变，方便前台展示和后台预览共用。
export const gradientToCss = ({ from, to, via }: GradientColors, direction = '135deg') => {
  if (via) {
    return `linear-gradient(${direction}, ${from} 0%, ${via} 50%, ${to} 100%)`;
  }
  return `linear-gradient(${direction}, ${from} 0%, ${to} 100%)`;
};

export const radialGlowToCss = (color: string) =>
  `radial-gradient(circle at top left, ${color}, rgba(255,255,255,0) 55%)`;

export const mergeHomeAppearanceConfig = (
  overrides?: HomeAppearanceConfigInput | null,
): HomeAppearanceConfig => ({
  headerBadge: {
    ...defaultHomeAppearance.headerBadge,
    ...overrides?.headerBadge,
  },
  utilityButton: {
    ...defaultHomeAppearance.utilityButton,
    ...overrides?.utilityButton,
  },
  searchBox: {
    ...defaultHomeAppearance.searchBox,
    ...overrides?.searchBox,
  },
  aiButton: {
    ...defaultHomeAppearance.aiButton,
    ...overrides?.aiButton,
  },
  keywordButton: {
    ...defaultHomeAppearance.keywordButton,
    ...overrides?.keywordButton,
  },
  folderCard: {
    ...defaultHomeAppearance.folderCard,
    ...overrides?.folderCard,
    gradient: {
      ...defaultHomeAppearance.folderCard.gradient,
      ...overrides?.folderCard?.gradient,
    },
    badge: {
      ...defaultHomeAppearance.folderCard.badge,
      ...overrides?.folderCard?.badge,
    },
    iconGradient: {
      ...defaultHomeAppearance.folderCard.iconGradient,
      ...overrides?.folderCard?.iconGradient,
    },
  },
  folderListIcon: {
    ...defaultHomeAppearance.folderListIcon,
    ...overrides?.folderListIcon,
  },
  fileListIcon: {
    ...defaultHomeAppearance.fileListIcon,
    ...overrides?.fileListIcon,
  },
  folderLink: {
    ...defaultHomeAppearance.folderLink,
    ...overrides?.folderLink,
  },
  viewToggle: {
    ...defaultHomeAppearance.viewToggle,
    ...overrides?.viewToggle,
  },
  previewButton: {
    ...defaultHomeAppearance.previewButton,
    ...overrides?.previewButton,
  },
});
