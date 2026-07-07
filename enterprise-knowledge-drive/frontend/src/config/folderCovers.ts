import { defaultHomeAppearance, type FolderCardAppearance } from './homeAppearance';

export type FolderCoverConfig = {
  folderId?: number;
  folderName?: string;
  title: string;
  subtitle: string;
  statsLabel: string;
  imageUrl?: string;
  theme: FolderCardAppearance;
};

const folderCoverConfigs: FolderCoverConfig[] = [
  {
    folderName: '新人第一天',
    title: '新人第一天',
    subtitle: '新员工入职指引与必备资料',
    statsLabel: '57 个文件',
    theme: defaultHomeAppearance.folderCard,
  },
  {
    folderName: '新人学习库',
    title: '新人学习库',
    subtitle: '学习资料与成长路径',
    statsLabel: '128 个文件',
    theme: defaultHomeAppearance.folderCard,
  },
  {
    folderName: '项目资料库',
    title: '项目资料库',
    subtitle: '项目文档与方案沉淀',
    statsLabel: '96 个文件',
    theme: defaultHomeAppearance.folderCard,
  },
];

export const getFolderCoverConfig = (
  folder: { id: number; name: string; description?: string; cover_url?: string | null },
  theme: FolderCardAppearance = defaultHomeAppearance.folderCard,
) => {
  const matched =
    folderCoverConfigs.find((item) => item.folderId === folder.id) ||
    folderCoverConfigs.find((item) => item.folderName === folder.name);

  return {
    title: matched?.title || folder.name,
    subtitle: matched?.subtitle || folder.description || '沉淀团队文档与知识资产',
    statsLabel: matched?.statsLabel || '文件夹',
    imageUrl: folder.cover_url || matched?.imageUrl,
    theme,
  };
};
