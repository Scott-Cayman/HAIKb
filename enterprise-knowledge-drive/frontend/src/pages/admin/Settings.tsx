import { useEffect, useMemo, useState } from 'react';
import { Bell, FileImage, Folder, Palette, Sparkles } from 'lucide-react';
import api from '../../services/api';
import {
  defaultHomeAppearance,
  gradientToCss,
  type HomeAppearanceConfig,
} from '../../config/homeAppearance';
import {
  getHomeAppearanceConfig,
  saveHomeAppearanceConfig,
} from '../../services/homeAppearance';

type FolderCoverItem = {
  id: number;
  name: string;
  cover_url?: string | null;
};

type ColorFieldGroup = {
  title: string;
  fields: Array<{ label: string; path: string }>;
};

const colorFieldGroups: ColorFieldGroup[] = [
  {
    title: '顶部区域',
    fields: [
      { label: '知识库标签背景', path: 'headerBadge.bg' },
      { label: '知识库标签文字', path: 'headerBadge.text' },
      { label: '功能按钮背景', path: 'utilityButton.bg' },
      { label: '功能按钮边框', path: 'utilityButton.border' },
      { label: '功能按钮图标', path: 'utilityButton.text' },
    ],
  },
  {
    title: '检索按钮',
    fields: [
      { label: 'AI 按钮渐变起点', path: 'aiButton.from' },
      { label: 'AI 按钮渐变终点', path: 'aiButton.to' },
      { label: 'AI 按钮文字', path: 'aiButton.text' },
      { label: '关键词按钮背景', path: 'keywordButton.bg' },
      { label: '关键词按钮文字', path: 'keywordButton.text' },
    ],
  },
  {
    title: '文件夹卡片',
    fields: [
      { label: '卡片渐变起点', path: 'folderCard.gradient.from' },
      { label: '卡片渐变中间色', path: 'folderCard.gradient.via' },
      { label: '卡片渐变终点', path: 'folderCard.gradient.to' },
      { label: '卡片发光层', path: 'folderCard.glowColor' },
      { label: '徽标背景', path: 'folderCard.badge.bg' },
      { label: '徽标文字', path: 'folderCard.badge.text' },
      { label: '图标底色起点', path: 'folderCard.iconGradient.from' },
      { label: '图标底色终点', path: 'folderCard.iconGradient.to' },
      { label: '图标颜色', path: 'folderCard.iconColor' },
    ],
  },
  {
    title: '列表与操作',
    fields: [
      { label: '文件夹图标起点', path: 'folderListIcon.from' },
      { label: '文件夹图标终点', path: 'folderListIcon.to' },
      { label: '文件夹图标颜色', path: 'folderListIcon.iconColor' },
      { label: '文件图标起点', path: 'fileListIcon.from' },
      { label: '文件图标终点', path: 'fileListIcon.to' },
      { label: '文件图标颜色', path: 'fileListIcon.iconColor' },
      { label: '文件夹标签背景', path: 'folderLink.bg' },
      { label: '文件夹标签文字', path: 'folderLink.text' },
      { label: '视图切换底色', path: 'viewToggle.trackBg' },
      { label: '视图切换选中背景', path: 'viewToggle.activeBg' },
      { label: '视图切换选中文字', path: 'viewToggle.activeText' },
      { label: '查看按钮背景', path: 'previewButton.bg' },
      { label: '查看按钮文字', path: 'previewButton.text' },
    ],
  },
];

const getNestedColorValue = (config: HomeAppearanceConfig, path: string): string => {
  return path.split('.').reduce((current: any, key) => current?.[key], config) ?? '#000000';
};

const setNestedColorValue = (
  config: HomeAppearanceConfig,
  path: string,
  value: string,
): HomeAppearanceConfig => {
  const next = JSON.parse(JSON.stringify(config)) as HomeAppearanceConfig;
  const keys = path.split('.');
  let cursor: any = next;

  keys.slice(0, -1).forEach((key) => {
    cursor = cursor[key];
  });
  cursor[keys[keys.length - 1]] = value;
  return next;
};

const Settings = () => {
  const [config, setConfig] = useState<HomeAppearanceConfig>(defaultHomeAppearance);
  const [folders, setFolders] = useState<FolderCoverItem[]>([]);
  const [initialFolders, setInitialFolders] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [{ config: appearanceConfig, updatedAt: appearanceUpdatedAt }, foldersResponse] = await Promise.all([
          getHomeAppearanceConfig(),
          api.get<FolderCoverItem[]>('/folders'),
        ]);

        setConfig(appearanceConfig);
        setUpdatedAt(appearanceUpdatedAt);
        setFolders(foldersResponse.data);
        setInitialFolders(
          Object.fromEntries(
            foldersResponse.data.map((folder) => [folder.id, folder.cover_url || '']),
          ),
        );
      } catch (error) {
        console.error('Failed to load settings', error);
        setMessage('系统配置加载失败，请刷新后重试');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const changedCovers = useMemo(
    () =>
      folders.filter((folder) => (folder.cover_url || '') !== (initialFolders[folder.id] || '')),
    [folders, initialFolders],
  );

  const handleColorChange = (path: string, value: string) => {
    setConfig((prev) => setNestedColorValue(prev, path, value));
  };

  const handleCoverChange = (folderId: number, value: string) => {
    setFolders((prev) =>
      prev.map((folder) =>
        folder.id === folderId
          ? { ...folder, cover_url: value }
          : folder,
      ),
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const [appearanceResult] = await Promise.all([
        saveHomeAppearanceConfig(config),
        ...changedCovers.map((folder) =>
          api.patch(`/folders/${folder.id}`, {
            cover_url: folder.cover_url?.trim() || null,
          }),
        ),
      ]);

      setUpdatedAt(appearanceResult.updatedAt);
      setInitialFolders(
        Object.fromEntries(
          folders.map((folder) => [folder.id, folder.cover_url || '']),
        ),
      );
      setMessage(`保存成功，已更新 ${changedCovers.length} 个封面设置`);
    } catch (error) {
      console.error('Failed to save settings', error);
      setMessage('保存失败，请检查封面地址或稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-slate-400">系统配置加载中...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">系统配置</h1>
        <p className="text-sm text-slate-400">
          管理首页按钮、卡片、图标配色，并为每个知识库设置可替换封面。
        </p>
        <p className="text-xs text-slate-500">
          最近保存时间：{updatedAt ? new Date(updatedAt).toLocaleString() : '尚未保存'}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-xl bg-indigo-500/15 p-2 text-indigo-300">
                <Palette className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">首页配色</h2>
                <p className="text-sm text-slate-400">管理员保存后，前台首页自动使用这些颜色。</p>
              </div>
            </div>

            <div className="space-y-6">
              {colorFieldGroups.map((group) => (
                <section key={group.title} className="rounded-2xl border border-slate-700/80 bg-slate-900/45 p-4">
                  <h3 className="mb-4 text-sm font-semibold text-slate-200">{group.title}</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.fields.map((field) => {
                      const value = getNestedColorValue(config, field.path);
                      return (
                        <label key={field.path} className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                          <span className="text-sm text-slate-300">{field.label}</span>
                          <div className="mt-3 flex items-center gap-3">
                            <input
                              type="color"
                              value={value}
                              onChange={(event) => handleColorChange(field.path, event.target.value)}
                              className="h-10 w-14 cursor-pointer rounded border border-slate-600 bg-transparent"
                            />
                            <input
                              type="text"
                              value={value}
                              onChange={(event) => handleColorChange(field.path, event.target.value)}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-500"
                            />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-300">
                <FileImage className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">文件夹封面</h2>
                <p className="text-sm text-slate-400">支持为首页卡片配置封面地址，留空则使用默认封面。</p>
              </div>
            </div>

            <div className="space-y-3">
              {folders.map((folder) => (
                <div key={folder.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4">
                  <div className="mb-2 flex items-center gap-2 text-slate-200">
                    <Folder className="h-4 w-4 text-emerald-300" />
                    <span className="font-medium">{folder.name}</span>
                  </div>
                  <input
                    type="text"
                    value={folder.cover_url || ''}
                    onChange={(event) => handleCoverChange(folder.id, event.target.value)}
                    placeholder="https://example.com/cover.png"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold text-white">效果预览</h2>
            <div className="space-y-5">
              <div className="rounded-[28px] bg-slate-950/40 p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div
                      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: config.headerBadge.bg,
                        color: config.headerBadge.text,
                      }}
                    >
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      Knowledge Base
                    </div>
                    <div className="mt-3 text-xl font-bold text-white">知识库</div>
                  </div>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border"
                    style={{
                      backgroundColor: config.utilityButton.bg,
                      borderColor: config.utilityButton.border,
                      color: config.utilityButton.text,
                    }}
                  >
                    <Bell className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-full px-4 py-2 text-sm font-semibold"
                    style={{
                      backgroundImage: gradientToCss(config.aiButton),
                      color: config.aiButton.text,
                    }}
                  >
                    AI 检索
                  </button>
                  <button
                    type="button"
                    className="rounded-full px-4 py-2 text-sm font-semibold"
                    style={{
                      backgroundColor: config.keywordButton.bg,
                      color: config.keywordButton.text,
                    }}
                  >
                    关键词检索
                  </button>
                </div>
              </div>

              <div
                className="relative overflow-hidden rounded-[28px] border border-white/10 p-5"
                style={{ backgroundImage: gradientToCss(config.folderCard.gradient) }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: `radial-gradient(circle at top left, ${config.folderCard.glowColor}, rgba(255,255,255,0) 55%)`,
                  }}
                />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <span
                      className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: config.folderCard.badge.bg,
                        color: config.folderCard.badge.text,
                      }}
                    >
                      57 个文件
                    </span>
                    <div className="mt-3 text-2xl font-black text-slate-900">文件夹卡片</div>
                    <div className="mt-2 text-sm text-slate-700">管理员保存后，首页卡片颜色立即生效。</div>
                  </div>
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{
                      backgroundImage: gradientToCss(config.folderCard.iconGradient),
                      color: config.folderCard.iconColor,
                    }}
                  >
                    <Folder className="h-6 w-6" />
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] bg-slate-950/40 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-2xl"
                      style={{ backgroundImage: gradientToCss(config.fileListIcon) }}
                    >
                      <FileImage className="h-5 w-5" style={{ color: config.fileListIcon.iconColor }} />
                    </div>
                    <div className="text-sm font-semibold text-white">文件列表项</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full px-4 py-2 text-sm font-semibold"
                    style={{
                      backgroundColor: config.previewButton.bg,
                      color: config.previewButton.text,
                    }}
                  >
                    查看
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ backgroundImage: gradientToCss(config.aiButton) }}
            >
              {isSaving ? '保存中...' : '保存配置'}
            </button>
            {message ? <p className="mt-3 text-sm text-slate-300">{message}</p> : null}
            <p className="mt-3 text-xs leading-6 text-slate-500">
              说明：封面目前使用图片地址方式替换，适合先快速落地。后续如需管理员上传图片文件，我可以继续补上传接口和素材管理。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
