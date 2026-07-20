import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarDays,
  ChevronDown,
  FileText,
  FileType,
  FolderOpen,
  Grid2X2,
  HardDrive,
  List,
  Loader2,
  Search,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  variant?: 'related' | 'keyword';
  total?: number;
  elapsedMs?: number | null;
};

type KeywordSortKey = 'relevance' | 'type' | 'size' | 'name' | 'modified';
type SortDirection = 'asc' | 'desc';

const KEYWORD_SORT_OPTIONS = [
  { key: 'relevance' as const, label: '相关度', Icon: Sparkles },
  { key: 'type' as const, label: '类型', Icon: FileType },
  { key: 'size' as const, label: '大小', Icon: HardDrive },
  { key: 'name' as const, label: '名称', Icon: ArrowDownAZ },
  { key: 'modified' as const, label: '修改日期', Icon: CalendarDays },
];

const guessFileExt = (fileName?: string | null) => {
  if (!fileName) return null;
  const index = fileName.lastIndexOf('.');
  if (index < 0) return null;
  return fileName.slice(index).toLowerCase();
};

const normalizedFileExt = (file: RelatedSearchFile) => {
  const rawExt = file.file_ext || guessFileExt(file.original_name) || '';
  return rawExt.replace(/^\./, '').trim().toLowerCase();
};

const formatFileSize = (value?: number | null) => {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '日期未知';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
};

const SearchFilePreviewPanel = ({
  files,
  loading = false,
  open,
  onClose,
  closable = true,
  variant = 'related',
  total,
  elapsedMs,
}: SearchFilePreviewPanelProps) => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [sortKey, setSortKey] = useState<KeywordSortKey>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const isKeywordMode = variant === 'keyword';

  useEffect(() => {
    setViewMode('list');
    setShowAllFiles(false);
    setSortKey('relevance');
    setSortDirection('desc');
    setFileTypeFilter('all');
  }, [variant]);

  const availableFileTypes = useMemo(
    () => Array.from(new Set(files.map(normalizedFileExt).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [files],
  );

  const orderedFiles = useMemo(() => {
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    const nextFiles = files.filter((file) => fileTypeFilter === 'all' || normalizedFileExt(file) === fileTypeFilter);
    const direction = sortDirection === 'asc' ? 1 : -1;

    return [...nextFiles].sort((left, right) => {
      let comparison = 0;

      if (sortKey === 'type') {
        comparison = collator.compare(normalizedFileExt(left), normalizedFileExt(right));
        if (comparison === 0) comparison = collator.compare(left.original_name, right.original_name);
      } else if (sortKey === 'size') {
        comparison = (left.size || 0) - (right.size || 0);
      } else if (sortKey === 'name') {
        comparison = collator.compare(left.original_name, right.original_name);
      } else if (sortKey === 'modified') {
        comparison = new Date(left.updated_at || left.created_at || 0).getTime() - new Date(right.updated_at || right.created_at || 0).getTime();
      } else {
        comparison = left.score - right.score;
      }

      return comparison * direction;
    });
  }, [fileTypeFilter, files, sortDirection, sortKey]);

  const selectSortKey = (nextKey: KeywordSortKey) => {
    setSortKey(nextKey);
    setSortDirection(nextKey === 'name' || nextKey === 'type' ? 'asc' : 'desc');
  };

  const openFileDetail = (fileId: number) => {
    navigate(`/files/${fileId}`, {
      state: { from: 'search' },
    });
  };

  const openContainingFolder = (fileId: number, folderId?: number | null) => {
    if (folderId) {
      navigate(`/folders/${folderId}`, {
        state: { from: 'search', fileId },
      });
      return;
    }

    openFileDetail(fileId);
  };

  const visibleFiles = (() => {
    if (isKeywordMode) return orderedFiles;
    if (showAllFiles) return orderedFiles;
    const sorted = [...orderedFiles];
    const strongMatches = sorted.filter((file) => file.score >= 0.72);
    const fallbackCount = strongMatches.length > 0 ? strongMatches.length : Math.min(3, sorted.length);
    return sorted.slice(0, fallbackCount);
  })();
  const hiddenFilesCount = Math.max(orderedFiles.length - visibleFiles.length, 0);

  if (!open) return null;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white md:rounded-[28px]">
      <div className={`flex items-center justify-between gap-2 border-b border-slate-100 ${isKeywordMode ? 'px-3 py-3 md:px-6 md:py-5' : 'px-3 py-3 md:px-5 md:py-4'}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isKeywordMode ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#eafaf7] text-[#26a99e]">
                <Search className="h-4 w-4" />
              </span>
            ) : null}
            <div>
              <div className={`${isKeywordMode ? 'text-base' : 'text-sm'} font-semibold text-slate-800`}>
                {isKeywordMode ? '关键词检索结果' : '相关文件'}
              </div>
              <div className="mt-1 hidden text-xs text-slate-400 sm:block">
                {isKeywordMode
                  ? '按文件名、描述、标签和已索引内容匹配，仅展示你有权查看的文件'
                  : '右侧展示当前搜索命中的相关文件，可切换列表与宫格视图'}
              </div>
            </div>
          </div>
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

      {isKeywordMode && files.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-[#fbfefd] px-3 py-3 md:px-6">
          <div className="mr-1 text-xs font-medium text-slate-400">筛选与排序</div>

          <label className="relative">
            <span className="sr-only">按文件类型筛选</span>
            <select
              value={fileTypeFilter}
              onChange={(event) => setFileTypeFilter(event.target.value)}
              className="h-9 appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-xs font-medium text-slate-600 outline-none transition hover:border-[#bde8e3] focus:border-[#62cec4] focus:ring-4 focus:ring-[#62cec4]/10"
            >
              <option value="all">全部类型</option>
              {availableFileTypes.map((fileType) => (
                <option key={fileType} value={fileType}>
                  {fileType.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </label>

          <div className="custom-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
            {KEYWORD_SORT_OPTIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => selectSortKey(key)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors ${
                  sortKey === key ? 'bg-white text-[#239f94] shadow-sm' : 'text-slate-500 hover:bg-white/75 hover:text-slate-700'
                }`}
                aria-pressed={sortKey === key}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition hover:border-[#bde8e3] hover:text-[#239f94]"
            title={sortDirection === 'asc' ? '当前为升序，点击切换为降序' : '当前为降序，点击切换为升序'}
            aria-label={sortDirection === 'asc' ? '切换为降序' : '切换为升序'}
          >
            {sortDirection === 'asc' ? <ArrowUpNarrowWide className="h-3.5 w-3.5" /> : <ArrowDownWideNarrow className="h-3.5 w-3.5" />}
            {sortDirection === 'asc' ? '升序' : '降序'}
          </button>

          <span className="w-full text-[11px] text-slate-400 sm:ml-auto sm:w-auto">当前显示 {orderedFiles.length} 个文件</span>
        </div>
      ) : null}

      <div className={`custom-scrollbar search-panel-scrollbar min-h-0 flex-1 snap-y snap-proximity overflow-y-auto overscroll-contain ${isKeywordMode ? 'px-3 py-3 md:px-6 md:py-5' : 'px-3 py-3 md:px-4 md:py-4'}`}>
        {loading ? (
          <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isKeywordMode ? '正在匹配文件名与内容…' : '正在整理相关文件...'}
          </div>
        ) : orderedFiles.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-sm text-slate-500">
            <Search className="mb-3 h-6 w-6 text-slate-300" />
            {isKeywordMode && fileTypeFilter !== 'all' ? `当前结果中没有 ${fileTypeFilter.toUpperCase()} 文件` : isKeywordMode ? '没有找到包含这些关键词的文件' : '当前还没有可预览的相关文件'}
            {isKeywordMode ? <span className="mt-2 text-xs text-slate-400">{fileTypeFilter !== 'all' ? '可以切换到“全部类型”继续查看' : '可以缩短关键词，或换一个文件主题再试'}</span> : null}
          </div>
        ) : viewMode === 'grid' ? (
          <>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
              {visibleFiles.map((file) => {
                const previewStatus = file.preview_status || 'unsupported';
                const fileExt = file.file_ext || guessFileExt(file.original_name);

                return (
                  <article
                    key={`preview-grid-file-${file.file_id}-${file.summary_id}`}
                    onClick={() => openFileDetail(file.file_id)}
                    className="snap-start cursor-pointer overflow-hidden rounded-[20px] border border-slate-100 bg-white"
                  >
                    <div className="relative bg-slate-50">
                      <div className="aspect-[16/10] w-full">
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
                          onClick={(event) => {
                            event.stopPropagation();
                            openContainingFolder(file.file_id, file.folder_id);
                          }}
                          className="inline-flex items-center gap-1 rounded-full bg-[#effaf7] px-2.5 py-1 text-[#2da99b] transition-colors hover:bg-[#e1f7f2]"
                          aria-label={`查看文件夹 ${file.original_name}`}
                          title="打开所属文件夹"
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
            {hiddenFilesCount > 0 ? (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllFiles(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-[#34b8aa] transition-colors hover:border-[#bfece7] hover:bg-[#effaf7]"
                >
                  查看更多推荐文件
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span className="text-slate-400">+{hiddenFilesCount}</span>
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="overflow-hidden rounded-[20px] border border-slate-100 bg-white">
            {visibleFiles.map((file) => {
              if (isKeywordMode) {
                return (
                  <article
                    key={`keyword-file-${file.file_id}-${file.summary_id ?? 'none'}`}
                    onClick={() => openFileDetail(file.file_id)}
                    className="group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-slate-100 px-3 py-3 transition-colors last:border-b-0 hover:bg-[#f8fdfc] md:gap-4 md:px-5 md:py-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f4fafb] ring-1 ring-slate-100">
                      <FileIconBadge
                        fileName={file.original_name}
                        className="flex h-10 w-10 items-center justify-center"
                        imageClassName="block h-9 w-9 object-contain"
                        fallbackClassName="h-6 w-6 text-slate-400"
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="line-clamp-1 text-[14px] font-semibold leading-6 text-slate-800 transition-colors group-hover:text-[#259f96]" title={file.original_name}>
                        {file.original_name}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs leading-5 text-slate-500">
                        {file.match_excerpt || file.one_line_judgement}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                        {(file.matched_fields || []).map((field) => (
                          <span key={`${file.file_id}-${field}`} className="inline-flex items-center gap-1 rounded-full bg-[#edf9f6] px-2 py-1 text-[#279b91]">
                            <Tags className="h-2.5 w-2.5" />
                            命中{field}
                          </span>
                        ))}
                        {file.folder_path ? (
                          <span className="max-w-[460px] truncate rounded-full bg-slate-50 px-2 py-1" title={file.folder_path}>
                            {file.folder_path}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="col-start-2 flex flex-wrap items-center justify-start gap-x-3 gap-y-2 text-[11px] text-slate-400 lg:col-auto lg:min-w-[230px] lg:flex-nowrap lg:justify-end lg:gap-4">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(file.updated_at || file.created_at)}
                      </span>
                      <span>{formatFileSize(file.size)}</span>
                      <span className="min-w-[56px] text-right font-medium text-[#279b91]">{(file.score * 100).toFixed(0)}%</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openContainingFolder(file.file_id, file.folder_id);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#effaf7] text-[#2da99b] transition-colors hover:bg-[#ddf5f0]"
                        aria-label={`查看文件夹 ${file.original_name}`}
                        title="打开所属文件夹"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </article>
                );
              }

              return (
                <article
                  key={`preview-file-${file.file_id}-${file.summary_id ?? 'none'}`}
                  onClick={() => openFileDetail(file.file_id)}
                    className="group flex snap-start cursor-pointer items-start gap-2.5 border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-[#fbfefe]"
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
                        onClick={(event) => {
                          event.stopPropagation();
                          openContainingFolder(file.file_id, file.folder_id);
                        }}
                        className="inline-flex items-center rounded-full bg-[#effaf7] p-1.5 text-[#2da99b] transition-colors hover:bg-[#e1f7f2]"
                        aria-label={`查看文件夹 ${file.original_name}`}
                        title="打开所属文件夹"
                      >
                        <FolderOpen className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {hiddenFilesCount > 0 ? (
              <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                <button
                  type="button"
                  onClick={() => setShowAllFiles(true)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-[#34b8aa] transition-colors hover:border-[#bfece7] hover:bg-[#effaf7]"
                >
                  查看更多推荐文件
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span className="text-slate-400">+{hiddenFilesCount}</span>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3 text-[11px] text-slate-400 md:px-5 md:text-xs">
        <div className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {isKeywordMode ? `共找到 ${total ?? files.length} 个文件` : `共预览 ${files.length} 个相关文件`}
        </div>
        {isKeywordMode && elapsedMs != null ? <span>检索耗时 {elapsedMs.toFixed(0)} ms</span> : null}
      </div>
    </aside>
  );
};

export default SearchFilePreviewPanel;
