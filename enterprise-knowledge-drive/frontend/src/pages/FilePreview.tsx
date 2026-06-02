import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  File as FileIcon,
  FileText,
  Loader2,
  Maximize2,
  RefreshCcw,
  Rows,
  Columns,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import api from '../services/api';
import FavoriteButton from '../components/FavoriteButton';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { ragApi } from '../services/ragApi';
import { useAuthStore } from '../stores/authStore';
import { formatSize } from '../utils';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FileDetail {
  id: number;
  original_name: string;
  file_ext: string;
  size: number;
  folder_id: number;
  preview_status: string;
  summary_status: string;
  uploaded_by: number;
}

const parseTagTokens = (value?: string | null) => {
  if (!value) return [] as string[];
  const trimmed = value.trim();
  if (!trimmed) return [] as string[];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Ignore parsing errors
  }
  return trimmed
    .split(/[\n,，、]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeTag = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text === '未识别') return null;
  return text;
};

const ImageViewer = ({ url, alt }: { url: string; alt: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (isExpanded) {
        setIsExpanded(false);
        return;
      }

      if (!document.fullscreenEnabled || !containerRef.current?.requestFullscreen) {
        setIsExpanded((value) => !value);
        setScale(0.8);
        return;
      }

      await containerRef.current.requestFullscreen();
      setScale(0.8);
    } catch {
      setIsExpanded((value) => !value);
      setScale(0.8);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  const isViewerMaximized = isFullscreen || isExpanded;

  const resetScale = () => setScale(1.0);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full w-full bg-slate-50 rounded-xl overflow-hidden border border-slate-200 ${
        isViewerMaximized ? 'fixed inset-0 z-50 rounded-none border-0' : ''
      }`}
    >
      <div className="flex items-center justify-between p-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex items-center space-x-1">
          <span className="text-sm font-medium text-slate-600 select-none">{alt}</span>
        </div>

        <div className="flex items-center space-x-1">
          <button onClick={() => setScale((s) => Math.max(0.2, s - 0.2))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-600 min-w-[3.5rem] text-center select-none">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(5.0, s + 0.2))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button onClick={resetScale} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 flex justify-center items-center bg-slate-200/50 custom-scrollbar">
        {!imageLoaded && (
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-slate-500 text-sm font-medium">加载图片...</p>
          </div>
        )}
        <img
          src={url}
          alt={alt}
          className="object-contain shadow-sm transition-transform duration-200"
          style={{ transform: `scale(${scale})`, display: imageLoaded ? 'block' : 'none' }}
          onLoad={() => setImageLoaded(true)}
        />
      </div>
    </div>
  );
};

const PdfViewer = ({ url }: { url: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [isContinuous, setIsContinuous] = useState<boolean>(false);
  const [autoFitDone, setAutoFitDone] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current && autoFitDone) {
        setScale(1.0);
      }
    };
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [autoFitDone]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    pageRefs.current = new Array(numPages).fill(null);
    setAutoFitDone(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePageOnLoadSuccess = (page: any) => {
    if (!autoFitDone && containerRef.current && page.originalWidth) {
      const containerWidth = containerRef.current.clientWidth - 48;
      const fitScale = containerWidth / page.originalWidth;
      setScale(Math.min(Math.max(fitScale, 0.5), 2.0));
      setAutoFitDone(true);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (isExpanded) {
        setIsExpanded(false);
        return;
      }

      if (!document.fullscreenEnabled || !containerRef.current?.requestFullscreen) {
        setIsExpanded((value) => !value);
        setScale(0.8);
        setAutoFitDone(true);
        return;
      }

      await containerRef.current.requestFullscreen();
      setScale(0.8);
      setAutoFitDone(true);
    } catch {
      setIsExpanded((value) => !value);
      setScale(0.8);
      setAutoFitDone(true);
    }
  };

  const handleScroll = () => {
    if (!isContinuous || !scrollContainerRef.current || !pageRefs.current.length) return;

    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const containerTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const containerCenter = containerTop + containerHeight / 2;

      let currentPage = 1;
      let minDistance = Infinity;

      pageRefs.current.forEach((pageRef, index) => {
        if (!pageRef) return;
        const pageTop = pageRef.offsetTop - container.offsetTop;
        const pageCenter = pageTop + pageRef.clientHeight / 2;
        const distance = Math.abs(containerCenter - pageCenter);

        if (distance < minDistance) {
          minDistance = distance;
          currentPage = index + 1;
        }
      });

      setPageNumber(currentPage);
    }, 100);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (isFullscreen || isExpanded)) {
        setIsExpanded(false);
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
        return;
      }

      if (!isContinuous && numPages) {
        if (event.key === 'ArrowLeft') {
          setPageNumber((p) => Math.max(1, p - 1));
        } else if (event.key === 'ArrowRight') {
          setPageNumber((p) => Math.min(numPages, p + 1));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isContinuous, isFullscreen, isExpanded, numPages]);

  const isViewerMaximized = isFullscreen || isExpanded;

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full w-full bg-slate-50 rounded-xl overflow-hidden border border-slate-200 ${
        isViewerMaximized ? 'fixed inset-0 z-50 rounded-none border-0' : ''
      }`}
    >
      <div className="flex items-center justify-between p-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50 text-slate-600 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-600 min-w-[4rem] text-center select-none">
            {pageNumber} / {numPages || '-'}
          </span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages || 1, p + 1))}
            disabled={pageNumber >= (numPages || 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50 text-slate-600 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-600 min-w-[3.5rem] text-center select-none">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3.0, s + 0.2))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIsContinuous(false)}
            className={`p-1.5 rounded-lg transition-colors ${!isContinuous ? 'bg-blue-500 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
          >
            <Columns className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsContinuous(true)}
            className={`p-1.5 rounded-lg transition-colors ${isContinuous ? 'bg-blue-500 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
          >
            <Rows className="w-5 h-5" />
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors ml-2">
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4 flex justify-center bg-slate-200/50 custom-scrollbar"
        onScroll={handleScroll}
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex flex-col items-center justify-center space-y-3 mt-20">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-slate-500 text-sm font-medium">解析 PDF 内容...</p>
            </div>
          }
          className="flex flex-col items-center"
        >
          {isContinuous && numPages ? (
            Array.from({ length: numPages }, (_, index) => (
              <div
                key={`page_${index + 1}`}
                ref={(el) => {
                  pageRefs.current[index] = el;
                }}
                className="mb-4"
              >
                <Page
                  pageNumber={index + 1}
                  scale={scale}
                  className="shadow-lg bg-white"
                  renderAnnotationLayer
                  renderTextLayer
                  onLoadSuccess={index === 0 ? handlePageOnLoadSuccess : undefined}
                />
              </div>
            ))
          ) : (
            <Page
              pageNumber={pageNumber}
              scale={scale}
              className="shadow-lg bg-white"
              renderAnnotationLayer
              renderTextLayer
              onLoadSuccess={handlePageOnLoadSuccess}
            />
          )}
        </Document>
      </div>
    </div>
  );
};

const FilePreview = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = !!user?.is_admin;
  const isSuperAdmin = !!user?.is_super_admin;
  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryActionLoading, setSummaryActionLoading] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState({
    client_type: '',
    project_type: '',
    document_type: '',
    region_tags: '',
    industry_tags: '',
    keyword_tags: '',
  });
  const pollAttemptsRef = useRef(0);
  const { favoriteFileIds, loadFavoriteStatus, toggleFileFavorite } = useFavoriteStatus();

  const [pollTrigger, setPollTrigger] = useState(0);

  const fetchSummary = useCallback(async () => {
    if (!id) return;
    try {
      const response = await ragApi.getFileSummary(Number(id));
      setSummaryData(response);
      return response;
    } catch (err) {
      console.error('获取总结失败', err);
    }
  }, [id]);

  useEffect(() => {
    let timer: number | undefined;
    let isMounted = true;
    pollAttemptsRef.current = 0;

    let isFirstFetch = true;

    const pollData = async () => {
      if (isFirstFetch) {
        setLoading(true);
        setSummaryLoading(true);
        isFirstFetch = false;
      }
      try {
        const fileResponse = await api.get(`/files/${id}`);
        if (!isMounted) return;
        setFile(fileResponse.data);
        
        const summaryResponse = await fetchSummary();
        if (!isMounted) return;
        
        const needsPreviewPoll = fileResponse.data.preview_status === 'pending';
        const needsSummaryPoll = summaryResponse?.summary_status === 'processing' || summaryResponse?.summary_status === 'pending';

        if (needsPreviewPoll) {
          pollAttemptsRef.current += 1;
          if (pollAttemptsRef.current >= 100) {
            setError('文件转换超时，请稍后重试');
            setLoading(false);
            return;
          }
        }

        setPreviewUrl(currentPreviewUrl => {
          if (fileResponse.data.preview_status === 'success' && !currentPreviewUrl) {
            api.get(`/files/${id}/preview`, { responseType: 'blob' }).then(blobResponse => {
              if (!isMounted) return;
              const url = window.URL.createObjectURL(new Blob([blobResponse.data]));
              setPreviewUrl(url);
            }).catch(console.error);
          }
          return currentPreviewUrl;
        });
        
        if (!needsPreviewPoll) {
          setLoading(false);
        }
        if (!needsSummaryPoll) {
          setSummaryLoading(false);
        }

        if (needsPreviewPoll || needsSummaryPoll) {
          timer = window.setTimeout(pollData, 3000);
        }
      } catch {
        if (!isMounted) return;
        setError('获取文件信息失败');
        setLoading(false);
        setSummaryLoading(false);
      }
    };

    pollData();

    return () => {
      isMounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [id, pollTrigger, fetchSummary]);

  useEffect(() => {
    return () => {
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!file?.id) return;

    loadFavoriteStatus({ fileIds: [file.id] }).catch((error) => {
      console.error('Failed to load favorite status', error);
    });
  }, [file?.id, loadFavoriteStatus]);

  const handleDownload = async () => {
    try {
      const response = await api.get(`/files/${id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', file?.original_name || 'download');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('下载失败', err);
      alert('下载失败');
    }
  };

  const handleToggleFileFavorite = async () => {
    if (!file?.id) return;
    try {
      await toggleFileFavorite(file.id);
    } catch (error) {
      console.error('Failed to toggle file favorite', error);
      alert('更新文件收藏失败，请稍后重试');
    }
  };

  const handleSummaryAction = async (action: 'summarize' | 'reindex') => {
    if (!id) return;
    setSummaryActionLoading(true);
    setSummaryLoading(true);
    try {
      if (action === 'summarize') {
        await ragApi.summarizeFile(Number(id));
      } else {
        await ragApi.reindexSummary(Number(id));
      }
      setPollTrigger(p => p + 1);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert((err as any)?.response?.data?.detail || '操作失败');
    } finally {
      setSummaryActionLoading(false);
    }
  };

  const renderPreview = () => {
    if (!file) return null;

    if (file.preview_status === 'pending') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 bg-slate-50 rounded-xl">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-slate-500">文件正在转换中，请稍候...</p>
        </div>
      );
    }

    if (file.preview_status === 'failed') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 bg-slate-50 rounded-xl">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-slate-500">文件转换失败，无法预览</p>
        </div>
      );
    }

    if (file.preview_status === 'unsupported') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 bg-slate-50 rounded-xl">
          <FileIcon className="w-16 h-16 text-slate-400" />
          <p className="text-slate-500">该格式暂不支持在线预览</p>
        </div>
      );
    }

    if (file.preview_status === 'success' && previewUrl) {
      const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(file.file_ext);
      if (isImage) {
        return <ImageViewer url={previewUrl} alt={file.original_name} />;
      }
      return <PdfViewer url={previewUrl} />;
    }

    return null;
  };

  const summary = summaryData?.summary;

  const currentRegionTags = useMemo(() => parseTagTokens(summary?.region_tags), [summary?.region_tags]);
  const currentIndustryTags = useMemo(() => parseTagTokens(summary?.industry_tags), [summary?.industry_tags]);
  const currentKeywordTags = useMemo(() => parseTagTokens(summary?.keyword_tags), [summary?.keyword_tags]);

  if (loading && !file) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-slate-600">{error || '文件不存在'}</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
          返回上一页
        </button>
      </div>
    );
  }

  const openTagEditor = () => {
    if (!summary) return;
    setTagDraft({
      client_type: summary.client_type || '',
      project_type: summary.project_type || '',
      document_type: summary.document_type || '',
      region_tags: currentRegionTags.join('，'),
      industry_tags: currentIndustryTags.join('，'),
      keyword_tags: currentKeywordTags.join('，'),
    });
    setTagEditorOpen(true);
  };

  const saveTags = async () => {
    if (!id) return;
    setTagSaving(true);
    try {
      await ragApi.updateFileTags(Number(id), {
        client_type: tagDraft.client_type.trim() || null,
        project_type: tagDraft.project_type.trim() || null,
        document_type: tagDraft.document_type.trim() || null,
        region_tags: parseTagTokens(tagDraft.region_tags),
        industry_tags: parseTagTokens(tagDraft.industry_tags),
        keyword_tags: parseTagTokens(tagDraft.keyword_tags),
      });
      setTagEditorOpen(false);
      await fetchSummary();
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert((err as any)?.response?.data?.detail || '保存标签失败');
    } finally {
      setTagSaving(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col space-y-4">
      <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center space-x-4">
          <button onClick={() => navigate(-1)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 line-clamp-1">{file.original_name}</h1>
            <div className="flex items-center space-x-3 text-sm text-slate-500 mt-1">
              <span>{formatSize(file.size)}</span>
              <span>•</span>
              <span className="uppercase">{file.file_ext.replace('.', '')}</span>
              <span>•</span>
              <span>总结状态: {summaryData?.summary_status || file.summary_status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <FavoriteButton
            active={favoriteFileIds.has(file.id)}
            title={favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件'}
            className="w-10 h-10"
            onClick={handleToggleFileFavorite}
          />
          {isSuperAdmin ? (
            <button onClick={handleDownload} className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium">
              <Download className="w-4 h-4" />
              <span>下载</span>
            </button>
          ) : (
            <span className="text-sm text-slate-500">如需下载请联系管理员</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_380px] gap-4 flex-1 min-h-0">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 min-h-0">{renderPreview()}</div>

        <aside className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 overflow-y-auto space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-slate-900">AI 总结</h2>
            </div>
            <button
              onClick={() => handleSummaryAction(summary ? 'reindex' : 'summarize')}
              disabled={summaryActionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors disabled:opacity-60"
            >
              {summaryActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              {summary ? '重新索引' : '生成总结'}
            </button>
          </div>

          {summaryLoading ? (
            <div className="flex items-center gap-3 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>AI 总结加载中...</span>
            </div>
          ) : summary ? (
            <>
              <section>
                <div className="text-xs text-slate-400 mb-2">一句话判断</div>
                <p className="text-sm text-slate-700 leading-7">{summary.one_line_judgement || '未生成'}</p>
              </section>

              <section>
                <div className="text-xs text-slate-400 mb-2">两句话简介</div>
                <p className="text-sm text-slate-700 leading-7">{summary.two_sentence_intro || '未生成'}</p>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-400">标签</div>
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      {tagEditorOpen ? (
                        <>
                          <button
                            onClick={() => setTagEditorOpen(false)}
                            disabled={tagSaving}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors disabled:opacity-60"
                          >
                            取消
                          </button>
                          <button
                            onClick={saveTags}
                            disabled={tagSaving}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs transition-colors disabled:opacity-60"
                          >
                            {tagSaving ? '保存中...' : '保存'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={openTagEditor}
                          className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors"
                        >
                          编辑标签
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                {tagEditorOpen ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">客户类型</div>
                        <input
                          value={tagDraft.client_type}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, client_type: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：政府 / 企业 / 校园"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">项目类型</div>
                        <input
                          value={tagDraft.project_type}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, project_type: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：招标 / 活动执行 / 运营"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">文档类型</div>
                        <input
                          value={tagDraft.document_type}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, document_type: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：标书 / 方案 / 报告"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">区域标签（用逗号分隔）</div>
                        <input
                          value={tagDraft.region_tags}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, region_tags: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：北京，上海，华北"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">行业标签（用逗号分隔）</div>
                        <input
                          value={tagDraft.industry_tags}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, industry_tags: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：文旅，教育，政务"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">关键词标签（用逗号分隔）</div>
                        <input
                          value={tagDraft.keyword_tags}
                          onChange={(event) => setTagDraft((prev) => ({ ...prev, keyword_tags: event.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                          placeholder="例如：企业文化，员工成长，三方共赢"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {[
                      summary.client_type,
                      summary.project_type,
                      summary.document_type,
                      ...currentIndustryTags,
                      ...currentRegionTags,
                      ...currentKeywordTags,
                    ]
                      .map(normalizeTag)
                      .filter(Boolean)
                      .map((tag, index) => (
                        <span key={`${String(tag)}-${index}`} className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs">
                          {tag}
                        </span>
                      ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">AI 总结暂未生成。</p>
              {summaryData?.summary_error ? <p className="text-sm text-red-500">{summaryData.summary_error}</p> : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default FilePreview;
