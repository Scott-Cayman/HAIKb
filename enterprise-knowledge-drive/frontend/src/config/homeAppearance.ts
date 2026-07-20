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

export type PinnedFolderAppearance = {
  badge: SurfaceColors;
};

export type HomeAppearanceConfig = {
  searchBox: Pick<SurfaceColors, 'bg' | 'border'>;
  aiButton: GradientColors & { text: string };
  keywordButton: SurfaceColors;
  folderCard: PinnedFolderAppearance;
};

export type HomeAppearanceConfigInput = Partial<{
  searchBox: Partial<HomeAppearanceConfig['searchBox']>;
  aiButton: Partial<HomeAppearanceConfig['aiButton']>;
  keywordButton: Partial<HomeAppearanceConfig['keywordButton']>;
  folderCard: Partial<{ badge: Partial<HomeAppearanceConfig['folderCard']['badge']> }>;
}>;

export const defaultHomeAppearance: HomeAppearanceConfig = {
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
    badge: {
      bg: '#ffffff',
      text: '#5e7d92',
    },
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
    badge: {
      ...defaultHomeAppearance.folderCard.badge,
      ...overrides?.folderCard?.badge,
    },
  },
});
