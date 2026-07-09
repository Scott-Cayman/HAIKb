import { FileText, FolderOpen, Grid2X2, List, Loader2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import FileIconBadge from '../files/FileIconBadge';
import FilePreviewThumbnail from '../files/FilePreviewThumbnail';
import type { RelatedSearchFile } from './RelatedFilesStrip';

type SearchFilePreviewPanelProps = {
  files: RelatedSearchFile[];
  loading?: boolean;
  open: boolean;
  onClose?: () => void;
  closable?: boolean;
};

const guessFileExt = (fileName?: string | null) => {
  if (!fileName) return null;
  const index = fileName.lastIndexOf('.');
  if (index < 0) return null;
  return fileName.slice(index).toLowerCase();
};

const SearchFilePreviewPanel = ({
  files,
  loading = false,
  open,
  onClose,
  closable = true,
}: SearchFilePreviewPanelProps) => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const openFileDetail = (fileId: number) => {
    navigate(`/files/${fileId}`, {
      state: { from: 'search' },
    });
  };

  if (!open) return null;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-slate-800">相关文件</div>
          <div className="mt-1 text-xs text-slate-400">右侧展示当前搜索命中的相关文件，可切换列表与宫格视图</div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-full bg-slate-100 p-[3px]">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded-full p-2 transition-all ${
                viewMode === 'list' ? 'bg-white text-[#33beae]' : 'text-slate-400 hover:text-slate-600'
              }`}
              title="列表视图"
              aria-label="列表视图"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-full p-2 transition-all ${
                viewMode === 'grid' ? 'bg-white text-[#33beae]' : 'text-slate-400 hover:text-slate-600'
              }`}
              title="宫格视图"
              aria-label="宫格视图"
            >
              <Grid2X2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {closable ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="关闭文件预览"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="custom-scrollbar search-panel-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在整理相关文件...
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-sm text-slate-500">
            <Search className="mb-3 h-6 w-6 text-slate-300" />
            当前还没有可预览的相关文件
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4">
            {files.map((file) => {
              const previewStatus = file.preview_status || 'unsupported';
              const fileExt = file.file_ext || guessFileExt(file.original_name);

              return (
                <article
                  key={`preview-grid-file-${file.file_id}-${file.summary_id}`}
                  className="overflow-hidden rounded-[20px] border border-slate-100 bg-white"
                >
                  <div className="relative bg-slate-50">
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
                    <div className="absolute left-2.5 top-2.5">
                      <FileIconBadge
                        fileName={file.original_name}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/94"
                        imageClassName="block h-5 w-5 object-contain"
                        fallbackClassName="h-4 w-4 text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5 px-3 py-3">
                    <div className="line-clamp-2 text-xs font-semibold leading-5 text-slate-800">{file.original_name}</div>
                    <div className="line-clamp-3 text-[11px] leading-4 text-slate-500">{file.one_line_judgement}</div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>相关度 {(file.score * 100).toFixed(0)}%</span>
                      <button
                        type="button"
                        onClick={() => openFileDetail(file.file_id)}
                        className="inline-flex items-center gap-1 rounded-full bg-[#effaf7] px-2.5 py-1 text-[#2da99b] transition-colors hover:bg-[#e1f7f2]"
                      >
                        <FolderOpen className="h-3 w-3" />
                        查看
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[20px] border border-slate-100 bg-white">
            {files.map((file) => {
              return (
                <article
                  key={`preview-file-${file.file_id}-${file.summary_id}`}
                  className="group flex items-start gap-2.5 border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-[#fbfefe]"
                >
                  <div className="shrink-0">
                    <FileIconBadge
                      fileName={file.original_name}
                      className="flex h-10 w-10 items-center justify-center"
                      imageClassName="block h-10 w-10 object-contain"
                      fallbackClassName="h-6 w-6 text-slate-400"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className="line-clamp-1 text-[13px] font-semibold leading-5 text-slate-700 transition-colors group-hover:text-[#34b8aa]"
                      title={file.original_name}
                    >
                      {file.original_name}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-slate-500">{file.one_line_judgement}</div>
                    <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] leading-none text-slate-400">
                      <span>相关度 {(file.score * 100).toFixed(0)}%</span>
                      <button
                        type="button"
                        onClick={() => openFileDetail(file.file_id)}
                        className="inline-flex items-center rounded-full bg-[#effaf7] p-1.5 text-[#2da99b] transition-colors hover:bg-[#e1f7f2]"
                        aria-label={`查看文件 ${file.original_name}`}
                        title="查看详情"
                      >
                        <FolderOpen className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
        <div className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          共预览 {files.length} 个相关文件
        </div>
      </div>
    </aside>
  );
};

export default SearchFilePreviewPanel;
