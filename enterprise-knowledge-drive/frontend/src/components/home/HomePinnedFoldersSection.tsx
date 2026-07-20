import { useEffect, useMemo, useState } from 'react';
import { Palette, Settings2 } from 'lucide-react';

import type { HomeAppearanceConfig } from '../../config/homeAppearance';
import { getFolderCoverConfig } from '../../config/folderCovers';
import type { FolderDisplayMode } from '../../config/folderVisuals';
import type { FolderSummary } from '../../services/homeFolders';
import FolderCoverArt from './FolderCoverArt';

type Props = {
  pinnedFolders: FolderSummary[];
  pinCandidates: FolderSummary[];
  appearanceConfig: HomeAppearanceConfig;
  canManagePins: boolean;
  onOpenFolder: (folderId: number) => void;
  onEditFolderStyle: (folderId: number) => void;
  onSavePins: (folderIds: number[]) => Promise<void>;
};

const HomePinnedFoldersSection = ({
  pinnedFolders,
  pinCandidates,
  appearanceConfig,
  canManagePins,
  onOpenFolder,
  onEditFolderStyle,
  onSavePins,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>(pinnedFolders.map((folder) => folder.id));

  useEffect(() => {
    setSelectedIds(pinnedFolders.map((folder) => folder.id));
  }, [pinnedFolders]);

  const pinnedIds = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleFolder = (folderId: number) => {
    setSelectedIds((prev) => (prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSavePins(selectedIds);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing && pinnedFolders.length === 0 && !canManagePins) {
    return null;
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[0_4px_14px_rgba(183,197,221,0.07)] backdrop-blur-xl">
      {canManagePins ? (
        <button
          type="button"
          onClick={() => {
            setSelectedIds(pinnedFolders.map((folder) => folder.id));
            setEditing((prev) => !prev);
          }}
          className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-800"
          title={editing ? '关闭置顶设置' : '置顶设置'}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      ) : null}

      {editing ? (
        <div className="absolute inset-2 z-20 flex min-h-0 flex-col rounded-[20px] border border-slate-200 bg-slate-50/95 p-3 pr-12 shadow-lg backdrop-blur-xl">
          <div className="shrink-0 text-sm font-medium text-slate-800">选择需要优先展示的项目文件夹</div>
          <div className="mt-2 grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {pinCandidates.map((folder) => (
              <label
                key={folder.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={pinnedIds.has(folder.id)}
                  onChange={() => toggleFolder(folder.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{folder.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{folder.description || '置顶后仅在当前目录入口展示'}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-2 flex shrink-0 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? '保存中...' : '保存置顶'}
            </button>
          </div>
        </div>
      ) : null}

      {pinnedFolders.length ? (
        <div className={`custom-scrollbar min-h-0 flex-1 overflow-x-auto px-3 py-3 transition-opacity ${editing ? 'opacity-20' : ''} ${canManagePins ? 'pr-14' : ''}`}>
          <div className="flex h-full min-w-max gap-3">
            {pinnedFolders.map((folder) => {
              const cover = getFolderCoverConfig(
                {
                  ...folder,
                  description: folder.description || undefined,
                  display_mode: (folder.display_mode as FolderDisplayMode | null | undefined) || undefined,
                },
                appearanceConfig.folderCard,
              );
              return (
                <article
                  key={folder.id}
                  className="group relative h-full w-[clamp(280px,28vw,380px)] shrink-0 overflow-hidden rounded-[20px] border border-white/90 bg-white text-left shadow-[0_2px_8px_rgba(169,196,216,0.07)] transition-all hover:-translate-y-px hover:border-[#d9ece8] hover:shadow-[0_7px_16px_rgba(178,200,220,0.11)]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenFolder(folder.id)}
                    className="absolute inset-0 z-20 cursor-pointer"
                    aria-label={`打开${folder.name}`}
                  />
                  <div
                    className="relative h-full min-h-[88px] overflow-hidden"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${cover.cardBgFrom} 0%, ${cover.cardBgVia} 56%, ${cover.cardBgTo} 100%)`,
                    }}
                  >
                    <FolderCoverArt
                      displayMode={cover.displayMode}
                      imageUrl={cover.imageUrl}
                      iconKey={cover.iconKey}
                      iconBgFrom={cover.iconBgFrom}
                      iconBgTo={cover.iconBgTo}
                      iconColor={cover.iconColor}
                      glowColor={cover.cardGlowColor}
                    />
                    <div
                      className="absolute left-3 top-3 z-10 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-[0_1px_4px_rgba(100,116,139,0.08)] backdrop-blur-md"
                      style={{ backgroundColor: cover.theme.badge.bg, color: cover.theme.badge.text }}
                    >
                      置顶目录
                    </div>
                    {folder.can_manage_settings ? (
                      <button
                        type="button"
                        onClick={() => onEditFolderStyle(folder.id)}
                        className="absolute right-3 top-3 z-30 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/92 px-2.5 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-white/80 backdrop-blur-md transition-all hover:bg-white hover:text-violet-600"
                        title="编辑封面、图标与配色"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        样式
                      </button>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 h-[76%] bg-gradient-to-t from-white/90 via-white/50 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 z-10 p-3.5 pr-20 text-slate-900">
                      <div className="truncate text-[15px] font-bold leading-5">
                        {cover.title}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] leading-4 text-slate-600">
                        {cover.subtitle}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-5 py-6 text-sm text-slate-400">当前目录还没有配置置顶内容</div>
      )}
    </div>
  );
};

export default HomePinnedFoldersSection;
