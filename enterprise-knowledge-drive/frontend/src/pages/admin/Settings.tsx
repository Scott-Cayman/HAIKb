import { useEffect, useState } from 'react';
import { CheckCircle2, Folder, Palette, Search, Sparkles } from 'lucide-react';

import {
  defaultHomeAppearance,
  gradientToCss,
  type HomeAppearanceConfig,
} from '../../config/homeAppearance';
import {
  getHomeAppearanceConfig,
  saveHomeAppearanceConfig,
} from '../../services/homeAppearance';

type ColorFieldGroup = {
  title: string;
  description: string;
  fields: Array<{ label: string; path: string }>;
};

// Only expose values that are consumed by the current Home page.
const colorFieldGroups: ColorFieldGroup[] = [
  {
    title: '首页检索区',
    description: '控制首页搜索框和两种检索入口的颜色。',
    fields: [
      { label: '搜索框背景', path: 'searchBox.bg' },
      { label: '搜索框边框', path: 'searchBox.border' },
      { label: 'AI 按钮渐变起点', path: 'aiButton.from' },
      { label: 'AI 按钮渐变终点', path: 'aiButton.to' },
      { label: 'AI 按钮文字', path: 'aiButton.text' },
      { label: '关键词按钮背景', path: 'keywordButton.bg' },
      { label: '关键词按钮文字', path: 'keywordButton.text' },
    ],
  },
  {
    title: '置顶目录标签',
    description: '目录封面、图标和卡片配色已改为在各文件夹内独立维护；这里只保留全局标签颜色。',
    fields: [
      { label: '标签背景', path: 'folderCard.badge.bg' },
      { label: '标签文字', path: 'folderCard.badge.text' },
    ],
  },
];

const getNestedColorValue = (config: HomeAppearanceConfig, path: string): string =>
  path.split('.').reduce((current: any, key) => current?.[key], config) ?? '#000000';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await getHomeAppearanceConfig();
        setConfig(result.config);
        setUpdatedAt(result.updatedAt);
      } catch (error) {
        console.error('Failed to load settings', error);
        setMessage('页面风格配置加载失败，请刷新后重试');
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveHomeAppearanceConfig(config);
      setConfig(result.config);
      setUpdatedAt(result.updatedAt);
      setMessage('首页配置已保存');
    } catch (error) {
      console.error('Failed to save settings', error);
      setMessage('保存失败，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="rounded-3xl border border-white/80 bg-white/75 p-8 text-sm text-slate-500">页面风格配置加载中...</div>;
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">页面风格配置</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">仅维护当前首页实际使用的全局样式；文件夹视觉样式在对应目录内单独设置。</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            9 项配置正在生效
          </div>
        </div>
        <p className="text-xs text-slate-400">最近保存：{updatedAt ? new Date(updatedAt).toLocaleString() : '尚未保存'}</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <section className="space-y-5 rounded-[28px] border border-white/85 bg-white/78 p-5 shadow-[0_18px_45px_rgba(148,174,194,0.12)] backdrop-blur-xl sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">生效中的首页配色</h2>
              <p className="text-sm text-slate-500">已移除保存后不会被前台读取的历史选项。</p>
            </div>
          </div>

          {colorFieldGroups.map((group) => (
            <div key={group.title} className="rounded-3xl border border-slate-100 bg-slate-50/65 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-800">{group.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{group.description}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => {
                  const value = getNestedColorValue(config, field.path);
                  return (
                    <label key={field.path} className="rounded-2xl border border-white bg-white/90 p-3 shadow-[0_5px_16px_rgba(148,163,184,0.08)]">
                      <span className="text-xs font-semibold text-slate-600">{field.label}</span>
                      <div className="mt-2.5 flex items-center gap-2.5">
                        <input
                          type="color"
                          value={value}
                          onChange={(event) => setConfig((current) => setNestedColorValue(current, field.path, event.target.value))}
                          className="h-10 w-12 cursor-pointer rounded-xl border border-slate-200 bg-transparent p-1"
                          aria-label={`${field.label}颜色选择`}
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(event) => setConfig((current) => setNestedColorValue(current, field.path, event.target.value))}
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-teal-300 focus:bg-white"
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <aside className="space-y-5">
          <div className="rounded-[28px] border border-white/85 bg-white/78 p-5 shadow-[0_18px_45px_rgba(148,174,194,0.12)] backdrop-blur-xl sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">实时预览</h2>
            <p className="mt-1 text-xs text-slate-500">预览内容与首页当前消费的配置保持一致。</p>

            <div className="mt-5 space-y-4">
              <div
                className="rounded-[24px] border p-3 shadow-[0_12px_25px_rgba(166,197,228,0.12)]"
                style={{ borderColor: config.searchBox.border, backgroundColor: config.searchBox.bg }}
              >
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Search className="h-4 w-4" />
                  请输入问题、关键词或文件主题
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold shadow-sm" style={{ backgroundImage: gradientToCss(config.aiButton), color: config.aiButton.text }}>
                    <Sparkles className="h-3.5 w-3.5" />AI 检索
                  </button>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold" style={{ backgroundColor: config.keywordButton.bg, color: config.keywordButton.text }}>
                    <Search className="h-3.5 w-3.5" />关键词检索
                  </button>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[24px] border border-emerald-100 bg-gradient-to-br from-[#effff9] via-[#e4fbf6] to-[#d8f7f1] p-5">
                <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/55 blur-2xl" />
                <span className="relative inline-flex rounded-full px-3 py-1 text-xs font-semibold shadow-sm" style={{ backgroundColor: config.folderCard.badge.bg, color: config.folderCard.badge.text }}>
                  置顶目录
                </span>
                <div className="relative mt-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-lg font-black text-slate-900">跨界营销中心</div>
                    <div className="mt-1 text-xs text-slate-500">目录封面与图标由文件夹独立配置</div>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-teal-400 text-white shadow-sm">
                    <Folder className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/85 bg-white/78 p-5 shadow-[0_18px_45px_rgba(148,174,194,0.12)] backdrop-blur-xl sm:p-6">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-[0_12px_25px_rgba(83,204,194,0.2)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
              style={{ backgroundImage: gradientToCss(config.aiButton) }}
            >
              {isSaving ? '保存中...' : '保存首页配置'}
            </button>
            {message ? <p className="mt-3 text-center text-sm font-medium text-slate-600">{message}</p> : null}
            <p className="mt-3 text-xs leading-5 text-slate-400">保存时只会提交当前仍被首页读取的字段，旧版本遗留字段不会再次写入。</p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Settings;
