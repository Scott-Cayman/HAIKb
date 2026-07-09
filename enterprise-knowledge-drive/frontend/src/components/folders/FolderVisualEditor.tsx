import { useMemo, useRef, useState } from 'react';

import { gradientToCss, radialGlowToCss } from '../../config/homeAppearance';
import FolderIconBadge from './FolderIconBadge';

type VisualRegionKey = 'cardBackground' | 'cardGlow' | 'iconBadge' | 'iconGlyph';

type VisualFormValues = {
  name: string;
  description: string;
  icon_key: string;
  icon_bg_from: string;
  icon_bg_to: string;
  icon_color: string;
  card_bg_from: string;
  card_bg_via: string;
  card_bg_to: string;
  card_glow_color: string;
};

type FolderVisualEditorProps = {
  value: VisualFormValues;
  onFieldChange: (field: keyof VisualFormValues, value: string) => void;
};

type RegionConfig = {
  key: VisualRegionKey;
  title: string;
  description: string;
  fields: Array<{
    key: keyof VisualFormValues;
    label: string;
  }>;
};

const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

const regionConfigs: RegionConfig[] = [
  {
    key: 'cardBackground',
    title: '卡片底色',
    description: '调整整张卡片的大底板渐变，也就是最容易感知的底色层。',
    fields: [
      { key: 'card_bg_from', label: '起点色' },
      { key: 'card_bg_via', label: '中间色' },
      { key: 'card_bg_to', label: '终点色' },
    ],
  },
  {
    key: 'cardGlow',
    title: '左上角发光层',
    description: '对应你选中的那层发光遮罩，主要影响卡片左上角的亮部氛围。',
    fields: [{ key: 'card_glow_color', label: '发光颜色' }],
  },
  {
    key: 'iconBadge',
    title: '图标底座',
    description: '图标背后的圆角色块，支持两段渐变。',
    fields: [
      { key: 'icon_bg_from', label: '起点色' },
      { key: 'icon_bg_to', label: '终点色' },
    ],
  },
  {
    key: 'iconGlyph',
    title: '图标本体',
    description: '图标线条本身的颜色。',
    fields: [{ key: 'icon_color', label: '图标颜色' }],
  },
];

const FolderVisualEditor = ({ value, onFieldChange }: FolderVisualEditorProps) => {
  const [activeRegion, setActiveRegion] = useState<VisualRegionKey>('cardBackground');
  const colorInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const currentRegion = useMemo(
    () => regionConfigs.find((region) => region.key === activeRegion) || regionConfigs[0],
    [activeRegion],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">点击卡片区域直接编辑</div>
            <div className="mt-1 text-sm text-slate-500">点哪里，就编辑哪里，避免靠字段名猜颜色。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {regionConfigs.map((region) => (
              <button
                key={region.key}
                type="button"
                onClick={() => setActiveRegion(region.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  activeRegion === region.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {region.title}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-5">
          <div
            className={`group relative min-h-[240px] overflow-hidden rounded-[28px] border border-white/80 p-5 shadow-[0_18px_40px_rgba(179,194,219,0.18)] transition-all ${
              activeRegion === 'cardBackground' ? 'ring-2 ring-blue-500/60 ring-offset-2 ring-offset-slate-50' : ''
            }`}
            style={{
              backgroundImage: gradientToCss({
                from: value.card_bg_from,
                via: value.card_bg_via,
                to: value.card_bg_to,
              }),
            }}
          >
            <button
              type="button"
              onClick={() => setActiveRegion('cardBackground')}
              className="absolute inset-0 z-10"
              aria-label="编辑卡片底色"
            />

            <div
              className={`absolute inset-0 ${activeRegion === 'cardGlow' ? 'ring-2 ring-inset ring-amber-400/90' : ''}`}
              style={{ backgroundImage: radialGlowToCss(value.card_glow_color) }}
            />
            <button
              type="button"
              onClick={() => setActiveRegion('cardGlow')}
              className="absolute left-0 top-0 z-20 h-[45%] w-[48%] rounded-tl-[28px] rounded-br-[40px]"
              aria-label="编辑左上角发光层"
            >
              <span
                className={`absolute left-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ${
                  activeRegion === 'cardGlow' ? 'bg-amber-500 text-white' : 'bg-white/85 text-slate-600'
                }`}
              >
                发光层
              </span>
            </button>

            <div className="absolute inset-y-5 right-4 w-[48%] overflow-hidden rounded-[24px]">
              <div className="relative h-full w-full">
                <div className="absolute bottom-4 left-1/2 h-16 w-24 -translate-x-1/2 rounded-full bg-white/30 blur-2xl" />
                <div className="absolute left-5 top-7 h-20 w-16 rounded-[1.6rem] bg-white/65 shadow-[0_10px_24px_rgba(255,255,255,0.4)] rotate-[-14deg]" />
                <div className="absolute left-12 top-10 h-20 w-16 rounded-[1.6rem] bg-white/40 shadow-[0_14px_28px_rgba(146,199,255,0.18)] rotate-[8deg]" />
                <div className="absolute bottom-7 right-8 z-20">
                  <button
                    type="button"
                    onClick={() => setActiveRegion('iconBadge')}
                    className={`absolute inset-[-8px] rounded-[1.7rem] ${
                      activeRegion === 'iconBadge' ? 'ring-2 ring-blue-500/90' : ''
                    }`}
                    aria-label="编辑图标底座"
                  />
                  <div className="relative">
                    <FolderIconBadge
                      iconKey={value.icon_key}
                      iconBgFrom={value.icon_bg_from}
                      iconBgTo={value.icon_bg_to}
                      iconColor={value.icon_color}
                      className="h-16 w-16 rounded-[1.4rem]"
                      iconClassName="h-7 w-7"
                    />
                    <button
                      type="button"
                      onClick={() => setActiveRegion('iconGlyph')}
                      className={`absolute inset-[15px] rounded-full ${
                        activeRegion === 'iconGlyph' ? 'ring-2 ring-emerald-500/90' : ''
                      }`}
                      aria-label="编辑图标颜色"
                    />
                  </div>
                </div>
                <div className="absolute bottom-5 left-6 h-10 w-10 rounded-full bg-white/85 shadow-[0_16px_26px_rgba(255,255,255,0.4)]" />
                <div className="absolute right-20 top-12 h-5 w-5 rounded-full bg-white/60" />
                <div className="absolute right-10 top-8 h-3 w-3 rounded-full bg-white/75" />
              </div>
            </div>

            <div className="relative z-10 flex min-h-[190px] max-w-[55%] flex-col">
              <div className="mb-4 flex items-start justify-between gap-2">
                <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
                  文件夹
                </span>
              </div>
              <h3 className="max-w-[180px] text-[28px] font-black leading-tight tracking-tight text-slate-900">
                {value.name || '文件夹名称'}
              </h3>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                {value.description || '点击右侧区域，直接修改卡片对应的颜色层。'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">{currentRegion.title}</div>
        <p className="mt-1 text-sm leading-6 text-slate-500">{currentRegion.description}</p>

        <div className="mt-5 space-y-4">
          {currentRegion.fields.map((field) => {
            const fieldValue = value[field.key];
            const safeColor = isHexColor(fieldValue) ? fieldValue : '#ffffff';
            return (
              <div key={field.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-medium text-slate-700">{field.label}</div>
                <div className="flex items-center gap-3">
                  <input
                    ref={(element) => {
                      colorInputRefs.current[field.key] = element;
                    }}
                    type="color"
                    value={safeColor}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    className="sr-only"
                  />
                  <button
                    type="button"
                    onClick={() => colorInputRefs.current[field.key]?.click()}
                    className="h-12 w-12 shrink-0 rounded-2xl border border-white shadow-[0_10px_20px_rgba(148,163,184,0.18)]"
                    style={{ background: fieldValue }}
                    aria-label={`选择${field.label}`}
                  />
                  <input
                    type="text"
                    value={fieldValue}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    placeholder="#ffffff"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          提示：点左侧卡片的不同区域，会自动切换到对应颜色组；颜色选择和文本输入都可以用。
        </div>
      </div>
    </div>
  );
};

export default FolderVisualEditor;
