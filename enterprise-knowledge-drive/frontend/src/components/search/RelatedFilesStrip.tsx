import { FolderOpen, Grid2X2, List, Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import FavoriteButton from '../FavoriteButton';
import FileIconBadge from '../files/FileIconBadge';
import FilePreviewThumbnail from '../files/FilePreviewThumbnail';
import type { RelatedFileItem } from '../../services/agentApi';

type RelatedSearchFile = RelatedFileItem & {
  file_ext?: string | null;
  preview_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  size?: number | null;
  folder_name?: string | null;
  folder_path?: string | null;
  matched_fields?: string[];
  match_excerpt?: string | null;
};

type RelatedFilesStripProps = {
  files: RelatedSearchFile[];
  loading: boolean;
  favoriteFileIds: Set<number>;
  onToggleFavorite: (fileId: number) => void;
  onOpenPreview: () => void;
};

const guessFileExt = (fileName?: string | null) => {
  if (!fileName) return null;
  const index = fileName.lastIndexOf('.');
  if (index < 0) return null;
  return fileName.slice(index).toLowerCase();
};

const RelatedFilesStrip = ({
  files,
  loading,
  favoriteFileIds,
  onToggleFavorite,
  onOpenPreview,
}: RelatedFilesStripProps) => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const openFileDetail = (fileId: number) => {
    navigate(`/files/${fileId}`, {
      state: { from: 'search' },
    });
  };

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/80 bg-white/72 shadow-[0_18px_40px_rgba(183,197,221,0.12)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/70 bg-white/70 px-5 py-4">
        <div className="text-sm text-slate-500">
          为你找到 <span className="px-1 text-lg font-bold text-[#32b9ae]">{files.length}</span> 个相关文件
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`rounded-full p-2 transition-colors ${
              viewMode === 'grid' ? 'bg-[#effaf7] text-[#2da99b]' : 'hover:bg-slate-100 hover:text-slate-500'
            }`}
            aria-label="网格显示文件"
          >
            <Grid2X2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`rounded-full p-2 transition-colors ${
              viewMode === 'list' ? 'bg-[#effaf7] text-[#2da99b]' : 'hover:bg-slate-100 hover:text-slate-500'
            }`}
            aria-label="列表显示文件"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onOpenPreview}
            className="rounded-full p-2 transition-colors hover:bg-slate-100 hover:text-slate-500"
            aria-label="打开右侧文件预览"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-1.5 px-5 py-4 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在匹配相关文件...
        </div>
      ) : files.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          当前问题没有匹配到推荐文件，可以尝试补充项目类型、部门名称或文档主题。
        </div>
      ) : viewMode === 'grid' ? (
        <div className="custom-scrollbar overflow-x-auto px-5 py-5">
          <div className="flex min-w-max gap-2.5">
            {files.map((file) => {
              const previewStatus = file.preview_status || 'unsupported';
              const fileExt = file.file_ext || guessFileExt(file.original_name);

              return (
                <article
                  key={`related-file-${file.file_id}-${file.summary_id}`}
                  onClick={() => openFileDetail(file.file_id)}
                  className="group w-[108px] shrink-0 cursor-pointer rounded-[16px] border border-slate-100 bg-white p-2 shadow-[0_8px_20px_rgba(184,200,225,0.12)] transition-all hover:-translate-y-0.5 hover:border-[#d8ece9] hover:shadow-[0_14px_24px_rgba(178,200,220,0.18)]"
                >
                  <div className="relative mb-2 overflow-hidden rounded-[14px] bg-slate-50">
                    <div className="aspect-[4/3] w-full">
                      <FilePreviewThumbnail
                        fileId={file.file_id}
                        fileName={file.original_name}
                        fileExt={fileExt}
                        previewStatus={previewStatus}
                        className="flex h-full w-full items-center justify-center"
                        imageClassName="h-full w-full object-cover"
                        fallbackClassName="h-7 w-7 text-slate-400"
                      />
                    </div>
                    <div className="absolute left-1.5 top-1.5">
                      <FileIconBadge
                        fileName={file.original_name}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/92 shadow-sm"
                        imageClassName="block h-4 w-4 object-contain"
                        fallbackClassName="h-3 w-3 text-slate-400"
                      />
                    </div>
                    <div className="absolute right-1.5 top-1.5">
                      <FavoriteButton
                        active={favoriteFileIds.has(file.file_id)}
                        title={favoriteFileIds.has(file.file_id) ? '取消收藏文件' : '收藏文件'}
                        className="h-6 w-6 rounded-full border-white/70 bg-white/92"
                        onClick={() => onToggleFavorite(file.file_id)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="line-clamp-2 min-h-[28px] text-[11px] font-semibold leading-4 text-slate-800 transition-colors group-hover:text-[#34b8aa]">
                      {file.original_name}
                    </div>
                    <div className="line-clamp-2 text-[10px] leading-4 text-slate-400">{file.one_line_judgement}</div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span>相关度 {(file.score * 100).toFixed(0)}%</span>
                    <Link
                      to={`/files/${file.file_id}`}
                      state={{ from: 'search' }}
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[#33b7ab] transition-colors hover:text-[#24998f]"
                    >
                      <FolderOpen className="h-3 w-3" />
                      查看
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-5 py-5">
          <div className="space-y-3">
            {files.map((file) => {
              const previewStatus = file.preview_status || 'unsupported';
              const fileExt = file.file_ext || guessFileExt(file.original_name);

              return (
                <article
                  key={`related-file-list-${file.file_id}-${file.summary_id}`}
                  onClick={() => openFileDetail(file.file_id)}
                  className="group flex cursor-pointer items-center gap-4 rounded-[22px] border border-slate-100 bg-white/90 px-4 py-4 shadow-[0_8px_24px_rgba(184,200,225,0.1)] transition-all hover:-translate-y-0.5 hover:border-[#d8ece9] hover:shadow-[0_16px_28px_rgba(178,200,220,0.14)]"
                >
                  <div className="relative w-28 shrink-0 overflow-hidden rounded-2xl bg-slate-50">
                    <div className="aspect-[4/3] w-full">
                      <FilePreviewThumbnail
                        fileId={file.file_id}
                        fileName={file.original_name}
                        fileExt={fileExt}
                        previewStatus={previewStatus}
                        className="flex h-full w-full items-center justify-center"
                        imageClassName="h-full w-full object-cover"
                        fallbackClassName="h-10 w-10 text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-1 text-sm font-semibold text-slate-800 transition-colors group-hover:text-[#34b8aa]">
                          {file.original_name}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{file.one_line_judgement}</div>
                      </div>
                      <FavoriteButton
                        active={favoriteFileIds.has(file.file_id)}
                        title={favoriteFileIds.has(file.file_id) ? '取消收藏文件' : '收藏文件'}
                        className="h-8 w-8 rounded-full border-white/70 bg-white/92"
                        onClick={() => onToggleFavorite(file.file_id)}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>相关度 {(file.score * 100).toFixed(0)}%</span>
                      <Link
                        to={`/files/${file.file_id}`}
                        state={{ from: 'search' }}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#33b7ab] transition-colors hover:text-[#24998f]"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        查看
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export type { RelatedSearchFile };
export default RelatedFilesStrip;
