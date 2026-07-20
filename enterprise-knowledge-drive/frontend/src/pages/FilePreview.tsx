import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
  Save,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  X,
  ShieldCheck,
  Building2,
  UsersRound,
  UserRound,
  Check,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import api from '../services/api';
import { API_BASE_URL } from '../services/backendConfig';
import FavoriteButton from '../components/FavoriteButton';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { ragApi } from '../services/ragApi';
import { useAuthStore } from '../stores/authStore';
import { formatSize } from '../utils';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
const SEARCH_PAGE_STORAGE_KEY = 'enterprise-knowledge-drive:ai-search-state';
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const PLAIN_TEXT_EXTS = new Set(['.txt']);

interface FileDetail {
  id: number;
  original_name: string;
  file_ext: string;
  size: number;
  folder_id: number | null;
  preview_status: string;
  preview_kind?: string | null;
  preview_page_count?: number;
  preview_error?: string | null;
  preview_version?: string | null;
  thumbnail_status?: string | null;
  summary_status: string;
  uploaded_by: number;
  capabilities?: {
    can_view: boolean;
    can_download: boolean;
    can_edit: boolean;
    can_rename: boolean;
    can_delete: boolean;
    can_upload: boolean;
    can_manage_settings: boolean;
    can_manage_permissions: boolean;
    can_pin_children: boolean;
  };
}

const normalizedFileExtension = (file: Pick<FileDetail, 'file_ext' | 'original_name'>) => {
  const storedExtension = (file.file_ext || '').trim().toLowerCase();
  if (storedExtension) {
    return storedExtension.startsWith('.') ? storedExtension : `.${storedExtension}`;
  }
  const suffixIndex = file.original_name.lastIndexOf('.');
  return suffixIndex >= 0 ? file.original_name.slice(suffixIndex).toLowerCase() : '';
};

const normalizeMarkdownPreviewSource = (source: string) => {
  const text = source.replace(/^\uFEFF/, '');
  const escapedHeadings = text.match(/(?:^|\n)\\#{1,6}\s/g)?.length || 0;
  const escapedEmphasis = text.match(/\\\*\\\*/g)?.length || 0;
  const escapedLists = text.match(/(?:^|\n)\s*(?:\\[-+*]|\d+\\\.)\s/g)?.length || 0;
  const isFullyEscapedMarkdown = escapedHeadings + Math.min(escapedEmphasis, 2) + Math.min(escapedLists, 2) >= 2;

  if (!isFullyEscapedMarkdown) return text;

  const escapablePunctuation = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
  return text.replace(/\\(.)/g, (match, character: string) => (
    escapablePunctuation.has(character) ? character : match
  ));
};

type PreviewZoomAnchor = {
  clientX: number;
  clientY: number;
  relativeX: number;
  relativeY: number;
};

const capturePreviewZoomAnchor = (
  viewport: HTMLElement,
  contentSelector: string,
  clientX: number,
  clientY: number,
): PreviewZoomAnchor | null => {
  const content = viewport.querySelector<HTMLElement>(contentSelector);
  if (!content) return null;
  const rect = content.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    clientX,
    clientY,
    relativeX: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    relativeY: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
};

const restorePreviewZoomAnchor = (
  viewport: HTMLElement,
  contentSelector: string,
  anchor: PreviewZoomAnchor,
) => {
  const content = viewport.querySelector<HTMLElement>(contentSelector);
  if (!content) return;
  const rect = content.getBoundingClientRect();
  const anchoredClientX = rect.left + rect.width * anchor.relativeX;
  const anchoredClientY = rect.top + rect.height * anchor.relativeY;
  viewport.scrollLeft += anchoredClientX - anchor.clientX;
  viewport.scrollTop += anchoredClientY - anchor.clientY;
};

const wheelDeltaInPixels = (event: WheelEvent, viewport: HTMLElement) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * viewport.clientHeight;
  return event.deltaY;
};

type PreviewCanvasZoomOptions = {
  scale: number;
  minScale: number;
  maxScale: number;
  contentSelector: string;
  onScaleChange: (scale: number) => void;
};

const pointerDistance = (first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

const pointerMidpoint = (first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) => ({
  clientX: (first.clientX + second.clientX) / 2,
  clientY: (first.clientY + second.clientY) / 2,
});

const usePreviewCanvasPan = (
  viewportRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  zoomOptions?: PreviewCanvasZoomOptions,
) => {
  const [isPanning, setIsPanning] = useState(false);
  const touchPointersRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const pinchStateRef = useRef<{
    startDistance: number;
    startScale: number;
    anchor: PreviewZoomAnchor | null;
  } | null>(null);
  const pendingPinchAnchorRef = useRef<PreviewZoomAnchor | null>(null);
  const zoomScaleRef = useRef(zoomOptions?.scale ?? 1);
  const panStateRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const zoomScale = zoomOptions?.scale;
  const zoomMinScale = zoomOptions?.minScale ?? 0.25;
  const zoomMaxScale = zoomOptions?.maxScale ?? 4;
  const zoomContentSelector = zoomOptions?.contentSelector;
  const onZoomScaleChange = zoomOptions?.onScaleChange;

  useEffect(() => {
    if (zoomScale === undefined) return;
    zoomScaleRef.current = zoomScale;
    const anchor = pendingPinchAnchorRef.current;
    const viewport = viewportRef.current;
    if (!anchor || !viewport || !zoomContentSelector) return;

    const frame = window.requestAnimationFrame(() => {
      restorePreviewZoomAnchor(viewport, zoomContentSelector, anchor);
      pendingPinchAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewportRef, zoomContentSelector, zoomScale]);

  useEffect(() => {
    if (enabled) return;
    panStateRef.current = null;
    pinchStateRef.current = null;
    pendingPinchAnchorRef.current = null;
    touchPointersRef.current.clear();
    setIsPanning(false);
  }, [enabled]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport || event.button !== 0) return;
    event.preventDefault();
    viewport.setPointerCapture?.(event.pointerId);

    if (event.pointerType === 'touch') {
      touchPointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touchPointersRef.current.size >= 2 && onZoomScaleChange && zoomContentSelector) {
        const [first, second] = Array.from(touchPointersRef.current.values()).slice(0, 2);
        const midpoint = pointerMidpoint(first, second);
        pinchStateRef.current = {
          startDistance: Math.max(pointerDistance(first, second), 1),
          startScale: zoomScaleRef.current,
          anchor: capturePreviewZoomAnchor(
            viewport,
            zoomContentSelector,
            midpoint.clientX,
            midpoint.clientY,
          ),
        };
        panStateRef.current = null;
        setIsPanning(true);
        return;
      }
    }

    panStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
  }, [enabled, onZoomScaleChange, viewportRef, zoomContentSelector]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled) return;

    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      const pinchState = pinchStateRef.current;
      if (pinchState && touchPointersRef.current.size >= 2 && onZoomScaleChange) {
        event.preventDefault();
        const [first, second] = Array.from(touchPointersRef.current.values()).slice(0, 2);
        const distance = Math.max(pointerDistance(first, second), 1);
        const midpoint = pointerMidpoint(first, second);
        const nextScale = Math.min(zoomMaxScale, Math.max(zoomMinScale, pinchState.startScale * (distance / pinchState.startDistance)));

        if (pinchState.anchor) {
          pendingPinchAnchorRef.current = {
            ...pinchState.anchor,
            clientX: midpoint.clientX,
            clientY: midpoint.clientY,
          };
        }
        zoomScaleRef.current = nextScale;
        onZoomScaleChange(nextScale);
        return;
      }
    }

    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.clientX);
    viewport.scrollTop = panState.scrollTop - (event.clientY - panState.clientY);
  }, [enabled, onZoomScaleChange, viewportRef, zoomMaxScale, zoomMinScale]);

  const stopPanning = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (event.pointerType === 'touch') {
      touchPointersRef.current.delete(event.pointerId);
      if (pinchStateRef.current && touchPointersRef.current.size < 2) {
        pinchStateRef.current = null;
        pendingPinchAnchorRef.current = null;
        const remainingPointer = Array.from(touchPointersRef.current.entries())[0];
        if (remainingPointer) {
          const [pointerId, point] = remainingPointer;
          panStateRef.current = {
            pointerId,
            clientX: point.clientX,
            clientY: point.clientY,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          };
        }
      }
    }

    const panState = panStateRef.current;
    if (panState?.pointerId === event.pointerId) {
      panStateRef.current = null;
    }
    if (viewport.hasPointerCapture?.(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    setIsPanning(Boolean(pinchStateRef.current || panStateRef.current));
  }, [viewportRef]);

  return {
    isPanning,
    panHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stopPanning,
      onPointerCancel: stopPanning,
      onLostPointerCapture: stopPanning,
    },
  };
};

type FilePermissionRule = { subject_type: 'all' | 'org' | 'user'; subject_value?: string | null };
type FilePermissions = {
  file_id: number;
  file_name: string;
  permission_rules: FilePermissionRule[];
  effective_permission_rules: FilePermissionRule[];
  inherited_from_folder_id?: number | null;
  inherited_from_folder_name?: string | null;
  available_org_units: string[];
  candidate_users: Array<{ id: number; name: string; department_name?: string | null }>;
};

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

const MediaFullscreenOverlay = ({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-3">
        <div className="hidden max-w-[60vw] truncate text-sm text-white/80 md:block">{title}</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          aria-label="关闭全屏预览"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex h-full w-full items-center justify-center p-6 md:p-10">
        {children}
      </div>
    </div>
  );
};

const MarkdownDocument = ({ source }: { source: string }) => (
  <article className="markdown-document mx-auto w-full max-w-4xl">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const external = Boolean(href && /^(https?:)?\/\//i.test(href));
          return (
            <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
              {children}
            </a>
          );
        },
        img: ({ alt, src, title }) => (
          <img src={src} alt={alt || ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  </article>
);

const MarkdownViewer = ({ source, title }: { source: string; title: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <FileText className="h-4 w-4" />
            </span>
            <span className="truncate">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="全屏阅读 Markdown"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="markdown-scroll flex-1 overflow-auto bg-[linear-gradient(180deg,#fbfefe_0%,#ffffff_18%)] px-5 py-7 sm:px-8 lg:px-12">
          <MarkdownDocument source={source} />
        </div>
      </div>

      <MediaFullscreenOverlay open={isExpanded} title={title} onClose={() => setIsExpanded(false)}>
        <div className="markdown-scroll h-full w-full max-w-6xl overflow-auto rounded-2xl bg-white px-6 py-8 sm:px-10 lg:px-16">
          <MarkdownDocument source={source} />
        </div>
      </MediaFullscreenOverlay>
    </>
  );
};

const PlainTextDocument = ({ source }: { source: string }) => (
  <pre className="mx-auto min-h-full w-full max-w-5xl whitespace-pre-wrap break-words font-mono text-[15px] leading-7 text-slate-700">
    {source}
  </pre>
);

const PlainTextViewer = ({ source, title }: { source: string; title: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <FileText className="h-4 w-4" />
            </span>
            <span className="truncate">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="全屏阅读文本"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-[linear-gradient(180deg,#f8fcfd_0%,#ffffff_20%)] px-5 py-7 sm:px-8 lg:px-12">
          <PlainTextDocument source={source} />
        </div>
      </div>

      <MediaFullscreenOverlay open={isExpanded} title={title} onClose={() => setIsExpanded(false)}>
        <div className="h-full w-full max-w-6xl overflow-auto rounded-2xl bg-white px-6 py-8 sm:px-10 lg:px-16">
          <PlainTextDocument source={source} />
        </div>
      </MediaFullscreenOverlay>
    </>
  );
};

const ImageViewer = ({ url, alt }: { url: string; alt: string }) => {
  const [scale, setScale] = useState<number>(1.0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const resetScale = () => setScale(1.0);

  return (
    <>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="custom-scrollbar z-10 flex shrink-0 items-center justify-start gap-3 overflow-x-auto border-b border-slate-200 bg-white p-2 shadow-sm md:justify-between md:p-3">
        <div className="flex shrink-0 items-center space-x-1">
          <span className="text-sm font-medium text-slate-600 select-none">{alt}</span>
        </div>

        <div className="flex shrink-0 items-center space-x-1">
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

        <div className="flex shrink-0 items-center space-x-1">
          <button onClick={() => setIsExpanded(true)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
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
          className="max-h-full max-w-full object-contain shadow-sm transition-transform duration-200"
          style={{ transform: `scale(${scale})`, display: imageLoaded ? 'block' : 'none' }}
          onLoad={() => setImageLoaded(true)}
        />
      </div>
      </div>

      <MediaFullscreenOverlay open={isExpanded} title={alt} onClose={() => setIsExpanded(false)}>
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      </MediaFullscreenOverlay>
    </>
  );
};

// 视频扩展名集合，用于判断是否走流式播放
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov']);

// 视频播放器组件：使用浏览器原生 <video> 标签，通过流式接口加载，支持拖动进度条
const VideoPlayer = ({ fileId }: { fileId: number }) => {
  const token = localStorage.getItem('token') || '';
  // 构建带 token 的流式播放 URL（<video> 标签无法设置自定义请求头）
  const streamUrl = `${API_BASE_URL}/files/${fileId}/stream?token=${encodeURIComponent(token)}`;
  const [isExpanded, setIsExpanded] = useState(false);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const activeElement = document.activeElement;
      const editableTags = ['INPUT', 'TEXTAREA', 'SELECT'];
      if (
        activeElement instanceof HTMLElement &&
        (editableTags.includes(activeElement.tagName) || activeElement.isContentEditable)
      ) {
        return;
      }

      const activeVideo = isExpanded ? expandedVideoRef.current : inlineVideoRef.current;
      if (!activeVideo) return;

      event.preventDefault();
      const duration = Number.isFinite(activeVideo.duration) ? activeVideo.duration : null;
      const nextTime = event.key === 'ArrowRight'
        ? activeVideo.currentTime + 15
        : activeVideo.currentTime - 15;

      if (duration === null) {
        activeVideo.currentTime = Math.max(0, nextTime);
        return;
      }

      activeVideo.currentTime = Math.min(Math.max(0, nextTime), duration);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  return (
    <>
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-xl bg-black">
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="absolute right-3 top-3 z-10 rounded-lg bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
          aria-label="全屏预览视频"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
        <video
          ref={inlineVideoRef}
          src={streamUrl}
          controls
          className="h-full w-full object-contain"
          preload="metadata"
        >
          您的浏览器不支持视频播放
        </video>
      </div>

      <MediaFullscreenOverlay open={isExpanded} title="视频预览" onClose={() => setIsExpanded(false)}>
        <video
          ref={expandedVideoRef}
          src={streamUrl}
          controls
          autoPlay
          className="max-h-full max-w-full object-contain"
          preload="metadata"
        >
          您的浏览器不支持视频播放
        </video>
      </MediaFullscreenOverlay>
    </>
  );
};

const PagedPreviewImage = ({
  fileId,
  pageNumber,
  title,
  onImageLoad,
}: {
  fileId: number;
  pageNumber: number;
  title: string;
  onImageLoad?: (dimensions: { width: number; height: number }) => void;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setUrl((current) => {
      if (current) window.URL.revokeObjectURL(current);
      return null;
    });
    setFailed(false);

    api.get(`/files/${fileId}/preview/pages/${pageNumber}`, {
      responseType: 'blob',
      signal: controller.signal,
    }).then((response) => {
      if (!controller.signal.aborted) {
        setUrl(window.URL.createObjectURL(new Blob([response.data], { type: 'image/jpeg' })));
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        console.error('分页预览加载失败', error);
        setFailed(true);
      }
    });

    return () => controller.abort();
  }, [fileId, pageNumber, retryKey]);

  useEffect(
    () => () => {
      if (url) window.URL.revokeObjectURL(url);
    },
    [url],
  );

  if (failed) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-100 text-slate-500">
        <AlertCircle className="h-8 w-8 text-amber-500" />
        <p className="text-sm">第 {pageNumber} 页暂时加载失败</p>
        <button
          type="button"
          onClick={() => setRetryKey((value) => value + 1)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-gradient-to-br from-slate-50 to-cyan-50/60 text-slate-500">
        <div className="h-12 w-12 animate-pulse rounded-2xl bg-white shadow-sm motion-reduce:animate-none" />
        <p className="text-sm font-medium">文件较大，正在从云端缓存中读取第 {pageNumber} 页</p>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`${title} 第 ${pageNumber} 页`}
      draggable={false}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (image.naturalWidth && image.naturalHeight) {
          onImageLoad?.({ width: image.naturalWidth, height: image.naturalHeight });
        }
      }}
      className="block h-auto w-full select-none rounded-xl bg-white shadow-sm"
    />
  );
};

const PagedImageViewer = ({
  fileId,
  title,
  pageCount,
}: {
  fileId: number;
  title: string;
  pageCount: number;
}) => {
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isContinuous, setIsContinuous] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const pendingZoomAnchorRef = useRef<PreviewZoomAnchor | null>(null);
  const handleGestureScaleChange = useCallback((nextScale: number) => {
    setScale(nextScale);
  }, []);
  const canvasPan = usePreviewCanvasPan(scrollContainerRef, !isContinuous, {
    scale,
    minScale: 0.25,
    maxScale: 4,
    contentSelector: '[data-preview-page-content]',
    onScaleChange: handleGestureScaleChange,
  });

  const applyFitScale = useCallback(() => {
    const viewport = scrollContainerRef.current;
    if (!viewport || !pageDimensions?.width || !pageDimensions.height) return;

    const computedStyle = window.getComputedStyle(viewport);
    const horizontalPadding = Number.parseFloat(computedStyle.paddingLeft) + Number.parseFloat(computedStyle.paddingRight);
    const verticalPadding = Number.parseFloat(computedStyle.paddingTop) + Number.parseFloat(computedStyle.paddingBottom);
    const availableWidth = Math.max(viewport.clientWidth - horizontalPadding, 1);
    const availableHeight = Math.max(viewport.clientHeight - verticalPadding, 1);
    const pageHeightAtFullWidth = availableWidth * (pageDimensions.height / pageDimensions.width);
    const nextFitScale = isContinuous
      ? 1
      : Math.min(1, availableHeight / Math.max(pageHeightAtFullWidth, 1));
    const boundedScale = Math.min(1, Math.max(0.25, nextFitScale));

    setFitScale(boundedScale);
    setScale(boundedScale);
  }, [isContinuous, pageDimensions]);

  const handlePreviewImageLoad = useCallback((dimensions: { width: number; height: number }) => {
    setPageDimensions((current) => (
      current?.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ));
  }, []);

  useEffect(() => {
    const viewport = scrollContainerRef.current;
    if (!viewport || !pageDimensions) return;

    const frame = window.requestAnimationFrame(applyFitScale);
    const observer = new ResizeObserver(applyFitScale);
    observer.observe(viewport);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [applyFitScale, isExpanded, pageDimensions]);

  useEffect(() => {
    scaleRef.current = scale;
    const anchor = pendingZoomAnchorRef.current;
    const viewport = scrollContainerRef.current;
    if (!anchor || !viewport) return;

    const frame = window.requestAnimationFrame(() => {
      restorePreviewZoomAnchor(viewport, '[data-preview-page-content]', anchor);
      pendingZoomAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scale]);

  useEffect(() => {
    const viewport = scrollContainerRef.current;
    if (!viewport || isContinuous) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = wheelDeltaInPixels(event, viewport);
      if (Math.abs(delta) < 0.5) return;
      const anchor = capturePreviewZoomAnchor(
        viewport,
        '[data-preview-page-content]',
        event.clientX,
        event.clientY,
      );
      if (!anchor) return;

      const zoomFactor = Math.exp(-delta * 0.0015);
      const nextScale = Math.min(4, Math.max(0.35, scaleRef.current * zoomFactor));
      if (Math.abs(nextScale - scaleRef.current) < 0.005) return;
      pendingZoomAnchorRef.current = anchor;
      scaleRef.current = nextScale;
      setScale(nextScale);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [isContinuous]);

  useEffect(() => {
    if (!isExpanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', close);
    };
  }, [isExpanded]);

  const pages = isContinuous
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [pageNumber];

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${isExpanded ? 'fixed inset-0 z-50 rounded-none' : 'h-full w-full'}`}>
      <div className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-700">轻量分页预览</div>
          <div className="text-xs text-slate-400">已缓存 {pageCount} 页 · 支持双指缩放</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setIsContinuous(false)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium ${!isContinuous ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="分页预览" title="分页预览：滚轮缩放">
            <Columns className="h-4 w-4" />
            <span>分页</span>
          </button>
          <button type="button" onClick={() => setIsContinuous(true)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium ${isContinuous ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="滚动预览" title="滚动预览：滚轮上下浏览">
            <Rows className="h-4 w-4" />
            <span>滚动</span>
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button type="button" onClick={() => setScale((value) => Math.max(0.25, Number((value - 0.1).toFixed(2))))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="缩小">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center text-xs font-medium text-slate-500">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((value) => Math.min(4, Number((value + 0.1).toFixed(2))))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="放大">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={applyFitScale} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="适应整页" title="适应整页">
            <RefreshCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={isExpanded ? '退出全屏' : '全屏预览'}>
            {isExpanded ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        {...canvasPan.panHandlers}
        data-preview-mode={isContinuous ? 'scroll' : 'page'}
        data-preview-panning={canvasPan.isPanning ? 'true' : 'false'}
        data-preview-scale={scale.toFixed(3)}
        data-preview-fit-scale={fitScale.toFixed(3)}
        data-preview-pinch-enabled={!isContinuous ? 'true' : 'false'}
        className={`flex-1 overflow-auto p-4 md:p-6 ${!isContinuous ? `${canvasPan.isPanning ? 'cursor-grabbing' : 'cursor-grab'} select-none` : ''}`}
        style={{ touchAction: isContinuous ? 'pan-y' : 'none' }}
      >
        <div
          data-preview-page-stack
          data-preview-centered={!isContinuous ? 'true' : 'false'}
          className={`mx-auto flex flex-col items-center gap-5 ${
            isContinuous ? '' : 'min-h-full justify-center'
          }`}
          style={{ width: `${scale * 100}%` }}
        >
          {pages.map((page) => (
            <div
              key={page}
              data-preview-page-content
              className={`w-full ${isContinuous ? '' : 'shrink-0'}`}
            >
              <PagedPreviewImage fileId={fileId} pageNumber={page} title={title} onImageLoad={handlePreviewImageLoad} />
            </div>
          ))}
        </div>
      </div>

      {!isContinuous ? (
        <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-white px-3 py-2">
          <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="上一页">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-24 text-center text-sm font-medium text-slate-600">{pageNumber} / {pageCount}</span>
          <button type="button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="下一页">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
};

const PdfViewer = ({ url, initialMode = 'page' }: { url: string; initialMode?: 'page' | 'scroll' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [isContinuous, setIsContinuous] = useState<boolean>(initialMode === 'scroll');
  const [autoFitDone, setAutoFitDone] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleRef = useRef(scale);
  const pendingZoomAnchorRef = useRef<PreviewZoomAnchor | null>(null);
  const handleGestureScaleChange = useCallback((nextScale: number) => {
    setScale(nextScale);
    setAutoFitDone(true);
  }, []);
  const canvasPan = usePreviewCanvasPan(scrollContainerRef, !isContinuous, {
    scale,
    minScale: 0.15,
    maxScale: 4,
    contentSelector: '.react-pdf__Page',
    onScaleChange: handleGestureScaleChange,
  });

  useEffect(() => {
    scaleRef.current = scale;
    const anchor = pendingZoomAnchorRef.current;
    const viewport = scrollContainerRef.current;
    if (!anchor || !viewport) return;

    const frame = window.requestAnimationFrame(() => {
      restorePreviewZoomAnchor(viewport, '.react-pdf__Page', anchor);
      pendingZoomAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scale]);

  useEffect(() => {
    const viewport = scrollContainerRef.current;
    if (!viewport || isContinuous) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = wheelDeltaInPixels(event, viewport);
      if (Math.abs(delta) < 0.5) return;
      const anchor = capturePreviewZoomAnchor(
        viewport,
        '.react-pdf__Page',
        event.clientX,
        event.clientY,
      );
      if (!anchor) return;

      const zoomFactor = Math.exp(-delta * 0.0015);
      const nextScale = Math.min(4, Math.max(0.15, scaleRef.current * zoomFactor));
      if (Math.abs(nextScale - scaleRef.current) < 0.005) return;
      pendingZoomAnchorRef.current = anchor;
      scaleRef.current = nextScale;
      setScale(nextScale);
      setAutoFitDone(true);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [isContinuous]);

  const applyFitScale = useCallback((pageWidth: number, pageHeight: number) => {
    const viewportContainer = scrollContainerRef.current || containerRef.current;
    if (!viewportContainer || !pageWidth || !pageHeight) return;

    const horizontalPadding = isContinuous ? 48 : 32;
    const verticalPadding = isContinuous ? 48 : 32;
    const availableWidth = Math.max(viewportContainer.clientWidth - horizontalPadding, 160);
    const availableHeight = Math.max(viewportContainer.clientHeight - verticalPadding, 160);

    const widthScale = availableWidth / pageWidth;
    const heightScale = availableHeight / pageHeight;
    const fitScale = isContinuous ? widthScale : Math.min(widthScale, heightScale);

    setScale(Math.min(Math.max(fitScale, 0.15), 2.0));
    setAutoFitDone(true);
  }, [isContinuous]);

  useEffect(() => {
    const updateScale = () => {
      const pageSize = pageSizeRef.current;
      if (pageSize && autoFitDone) {
        applyFitScale(pageSize.width, pageSize.height);
      }
    };
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [applyFitScale, autoFitDone]);

  useEffect(() => {
    const pageSize = pageSizeRef.current;
    if (pageSize) {
      applyFitScale(pageSize.width, pageSize.height);
    }
  }, [applyFitScale, isExpanded, isFullscreen]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    pageRefs.current = new Array(numPages).fill(null);
    setAutoFitDone(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePageOnLoadSuccess = (page: any) => {
    const pageWidth = page?.originalWidth || page?.width;
    const pageHeight = page?.originalHeight || page?.height;
    if (pageWidth && pageHeight) {
      pageSizeRef.current = { width: pageWidth, height: pageHeight };
    }

    if (!autoFitDone && pageSizeRef.current) {
      applyFitScale(pageSizeRef.current.width, pageSizeRef.current.height);
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
        setAutoFitDone(false);
        return;
      }

      await containerRef.current.requestFullscreen();
      setAutoFitDone(false);
    } catch {
      setIsExpanded((value) => !value);
      setAutoFitDone(false);
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

      if ((isFullscreen || isExpanded) && numPages) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (isContinuous) {
            setIsContinuous(false);
          }
          setPageNumber((p) => Math.max(1, p - 1));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          if (isContinuous) {
            setIsContinuous(false);
          }
          setPageNumber((p) => Math.min(numPages, p + 1));
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
      <div className="custom-scrollbar z-10 flex shrink-0 items-center justify-start gap-3 overflow-x-auto border-b border-slate-200 bg-white p-2 shadow-sm md:justify-between md:p-3">
        <div className="flex shrink-0 items-center space-x-1">
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

        <div className="flex shrink-0 items-center space-x-1">
          <button onClick={() => setScale((s) => Math.max(0.15, Number((s - 0.1).toFixed(2))))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="缩小">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-600 min-w-[3.5rem] text-center select-none">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(4, Number((s + 0.1).toFixed(2))))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="放大">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              const pageSize = pageSizeRef.current;
              if (pageSize) applyFitScale(pageSize.width, pageSize.height);
            }}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
            aria-label="适应整页"
            title="适应整页"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center space-x-1">
          <button
            onClick={() => setIsContinuous(false)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${!isContinuous ? 'bg-cyan-500 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
            aria-label="分页预览"
            title="分页预览：滚轮以鼠标位置为中心缩放"
          >
            <Columns className="h-4 w-4" />
            <span>分页</span>
          </button>
          <button
            onClick={() => setIsContinuous(true)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${isContinuous ? 'bg-cyan-500 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
            aria-label="滚动预览"
            title="滚动预览：滚轮上下浏览文档"
          >
            <Rows className="h-4 w-4" />
            <span>滚动</span>
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors ml-2">
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        {...canvasPan.panHandlers}
        data-preview-mode={isContinuous ? 'scroll' : 'page'}
        data-preview-panning={canvasPan.isPanning ? 'true' : 'false'}
        data-preview-scale={scale.toFixed(3)}
        data-preview-pinch-enabled={!isContinuous ? 'true' : 'false'}
        className={`flex-1 overflow-auto p-4 bg-slate-200/50 custom-scrollbar ${!isContinuous ? `${canvasPan.isPanning ? 'cursor-grabbing' : 'cursor-grab'} select-none` : ''}`}
        style={{ touchAction: isContinuous ? 'pan-y' : 'none' }}
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
          className="mx-auto flex w-max min-w-full flex-col items-center"
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
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = !!user?.is_admin;
  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [markdownSource, setMarkdownSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryActionLoading, setSummaryActionLoading] = useState(false);
  const [manualSummaryOpen, setManualSummaryOpen] = useState(false);
  const [manualSummaryText, setManualSummaryText] = useState('');
  const [manualSummarySaving, setManualSummarySaving] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [filePermissions, setFilePermissions] = useState<FilePermissions | null>(null);
  const [permissionRules, setPermissionRules] = useState<FilePermissionRule[]>([]);
  const [permissionUserQuery, setPermissionUserQuery] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState({
    client_type: '',
    project_type: '',
    document_type: '',
    region_tags: '',
    industry_tags: '',
    keyword_tags: '',
  });
  const pollAttemptsRef = useRef(0);
  const previewRequestStartedRef = useRef(false);
  const { favoriteFileIds, loadFavoriteStatus, toggleFileFavorite } = useFavoriteStatus();

  const [pollTrigger, setPollTrigger] = useState(0);
  const cameFromSearch =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    location.state.from === 'search';

  const handleBack = useCallback(() => {
    const historyIndex =
      typeof window !== 'undefined' && typeof window.history.state?.idx === 'number'
        ? window.history.state.idx
        : 0;

    if (cameFromSearch && historyIndex > 0) {
      navigate(-1);
      return;
    }

    if (cameFromSearch && typeof window !== 'undefined' && window.sessionStorage.getItem(SEARCH_PAGE_STORAGE_KEY)) {
      navigate('/search', { replace: true });
      return;
    }

    navigate(-1);
  }, [cameFromSearch, navigate]);

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
    previewRequestStartedRef.current = false;
    setPreviewUrl(null);
    setMarkdownSource(null);
    setError(null);

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

        // 视频使用 Range 流式接口；大文件演示文稿使用分页缓存。两者都不下载完整 blob。
        const shouldLoadPreviewPayload =
          fileResponse.data.preview_status === 'success'
          && !VIDEO_EXTS.has(normalizedFileExtension(fileResponse.data))
          && fileResponse.data.preview_kind !== 'pages'
          && !previewRequestStartedRef.current;
        if (shouldLoadPreviewPayload) {
          previewRequestStartedRef.current = true;
          const fileExtension = normalizedFileExtension(fileResponse.data);
          const isMarkdown =
            fileResponse.data.preview_kind === 'markdown'
            || MARKDOWN_EXTS.has(fileExtension);
          const isPlainText =
            fileResponse.data.preview_kind === 'text'
            || PLAIN_TEXT_EXTS.has(fileExtension);
          api.get(`/files/${id}/preview`, {
            responseType: isMarkdown || isPlainText ? 'text' : 'blob',
            params: fileResponse.data.preview_version ? { v: fileResponse.data.preview_version } : undefined,
          }).then((previewResponse) => {
            if (!isMounted) return;
            if (isMarkdown) {
              setMarkdownSource(normalizeMarkdownPreviewSource(String(previewResponse.data ?? '')));
              return;
            }
            if (isPlainText) {
              setMarkdownSource(String(previewResponse.data ?? '').replace(/^\uFEFF/, ''));
              return;
            }
            const url = window.URL.createObjectURL(new Blob([previewResponse.data]));
            setPreviewUrl(url);
          }).catch((previewError) => {
            previewRequestStartedRef.current = false;
            console.error('文件预览加载失败', previewError);
          });
        }
        
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

  // 保存手动编写的总结（用于视频等不支持自动解析的格式）
  const handleSaveManualSummary = async () => {
    if (!id || !manualSummaryText.trim()) return;
    setManualSummarySaving(true);
    setSummaryLoading(true);
    try {
      await ragApi.saveManualSummary(Number(id), manualSummaryText.trim());
      setManualSummaryOpen(false);
      setManualSummaryText('');
      setPollTrigger(p => p + 1);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert((err as any)?.response?.data?.detail || '保存失败');
    } finally {
      setManualSummarySaving(false);
    }
  };

  const renderPreview = () => {
    if (!file) return null;

    if (file.preview_status === 'pending') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl bg-gradient-to-br from-cyan-50/70 via-white to-sky-50/70 px-6 text-center">
          <div className="h-16 w-16 animate-pulse rounded-[22px] border border-white bg-white/85 shadow-[0_16px_40px_rgba(34,197,184,0.12)] motion-reduce:animate-none" />
          <div>
            <p className="font-semibold text-slate-700">文件较大，正在生成轻量预览</p>
            <p className="mt-1 text-sm text-slate-500">上传完成后会自动压缩并缓存封面与分页图片，无需停留在此页面</p>
          </div>
        </div>
      );
    }

    if (file.preview_status === 'failed') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 bg-slate-50 rounded-xl px-6 text-center">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <div>
            <p className="font-medium text-slate-700">文件转换失败，暂时无法预览</p>
            {file.preview_error ? <p className="mt-1 max-w-xl text-sm text-slate-500">{file.preview_error}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => setPollTrigger((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <RefreshCcw className="h-4 w-4" />
            重新生成预览
          </button>
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

    if (file.preview_status === 'success') {
      const fileExtension = normalizedFileExtension(file);
      const isMarkdown = file.preview_kind === 'markdown' || MARKDOWN_EXTS.has(fileExtension);
      const isPlainText = file.preview_kind === 'text' || PLAIN_TEXT_EXTS.has(fileExtension);
      if (isMarkdown) {
        if (markdownSource === null) {
          return (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-teal-500 motion-reduce:animate-none" />
              <p className="text-sm font-medium">正在载入 Markdown 文档</p>
            </div>
          );
        }
        return <MarkdownViewer source={markdownSource} title={file.original_name} />;
      }
      if (isPlainText) {
        if (markdownSource === null) {
          return (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-sky-500 motion-reduce:animate-none" />
              <p className="text-sm font-medium">正在载入文本文件</p>
            </div>
          );
        }
        return <PlainTextViewer source={markdownSource} title={file.original_name} />;
      }
      // 视频文件：直接流式播放，不依赖 previewUrl（blob）
      if (VIDEO_EXTS.has(fileExtension)) {
        return <VideoPlayer fileId={file.id} />;
      }
      if (file.preview_kind === 'pages' && (file.preview_page_count || 0) > 0) {
        return (
          <PagedImageViewer
            fileId={file.id}
            title={file.original_name}
            pageCount={file.preview_page_count || 1}
          />
        );
      }
      if (!previewUrl) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 text-slate-500">
            <div className="h-14 w-14 animate-pulse rounded-2xl bg-white shadow-sm motion-reduce:animate-none" />
            <p className="text-sm font-medium">正在载入轻量预览</p>
          </div>
        );
      }
      const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileExtension);
      if (isImage) {
        return <ImageViewer url={previewUrl} alt={file.original_name} />;
      }
      return (
        <PdfViewer
          key={`${file.id}:${previewUrl}`}
          url={previewUrl}
          initialMode={['.xls', '.xlsx'].includes(fileExtension) ? 'scroll' : 'page'}
        />
      );
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
        <button onClick={handleBack} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
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

  const openPermissionEditor = async () => {
    if (!id) return;
    setPermissionOpen(true);
    setPermissionLoading(true);
    setPermissionError(null);
    try {
      const response = await api.get<FilePermissions>(`/files/${id}/permissions`);
      setFilePermissions(response.data);
      setPermissionRules(response.data.permission_rules || []);
    } catch (err: any) {
      setPermissionError(err?.response?.data?.detail || '文件权限加载失败');
    } finally {
      setPermissionLoading(false);
    }
  };

  const hasPermissionRule = (subjectType: FilePermissionRule['subject_type'], value?: string | null) =>
    permissionRules.some((rule) => rule.subject_type === subjectType && (rule.subject_value || null) === (value || null));

  const togglePermissionRule = (subjectType: FilePermissionRule['subject_type'], value?: string | null) => {
    const exists = hasPermissionRule(subjectType, value);
    setPermissionRules((rules) => exists
      ? rules.filter((rule) => !(rule.subject_type === subjectType && (rule.subject_value || null) === (value || null)))
      : [...rules, { subject_type: subjectType, subject_value: value || null }]);
  };

  const saveFilePermissions = async () => {
    if (!id) return;
    setPermissionSaving(true);
    setPermissionError(null);
    try {
      const response = await api.put<FilePermissions>(`/files/${id}/permissions`, { view_rules: permissionRules });
      setFilePermissions(response.data);
      setPermissionRules(response.data.permission_rules || []);
      setPermissionOpen(false);
    } catch (err: any) {
      setPermissionError(err?.response?.data?.detail || '文件权限保存失败');
    } finally {
      setPermissionSaving(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col space-y-3 md:h-[calc(100vh-8rem)] md:min-h-0 md:space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between md:p-4">
        <div className="flex min-w-0 items-center gap-2 md:space-x-2">
          <button onClick={handleBack} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-slate-900 line-clamp-1">{file.original_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 sm:text-sm">
              <span>{formatSize(file.size)}</span>
              <span>•</span>
              <span className="uppercase">{file.file_ext.replace('.', '')}</span>
              <span>•</span>
              <span>总结状态: {summaryData?.summary_status || file.summary_status}</span>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:space-x-1">
          {file.capabilities?.can_manage_permissions && (
            <button onClick={() => void openPermissionEditor()} className="flex items-center space-x-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              <span>权限</span>
            </button>
          )}
          <FavoriteButton
            active={favoriteFileIds.has(file.id)}
            title={favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件'}
            className="w-10 h-10"
            onClick={handleToggleFileFavorite}
          />
          {file.capabilities?.can_download ? (
            <button onClick={handleDownload} className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium">
              <Download className="w-4 h-4" />
              <span>下载</span>
            </button>
          ) : (
            <span className="text-xs text-slate-500 sm:text-sm">当前账号暂无下载权限</span>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-none grid-cols-1 gap-3 md:flex-1 md:gap-4 xl:grid-cols-[minmax(0,2fr)_380px]">
        <div className="h-[62dvh] min-h-[420px] rounded-2xl border border-slate-100 bg-white p-2 shadow-sm md:h-auto md:min-h-0 md:p-4">{renderPreview()}</div>

        <aside className="space-y-5 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
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

              {/* 手动编写总结（用于视频等不支持自动解析的格式） */}
              {isAdmin && !manualSummaryOpen && (
                <button
                  onClick={() => setManualSummaryOpen(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm transition-colors"
                >
                  <Save className="w-4 h-4" />
                  手动编写总结
                </button>
              )}

              {manualSummaryOpen && (
                <div className="space-y-3">
                  <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                    该文件格式不支持 AI 自动解析，您可以手动编写总结内容，保存后将自动被索引用于 AI 检索。
                  </div>
                  <textarea
                    value={manualSummaryText}
                    onChange={(e) => setManualSummaryText(e.target.value)}
                    placeholder="请输入该文件的总结内容，例如：这是一段关于 XX 项目的会议录像，主要讨论了项目进度和交付要求..."
                    rows={6}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm resize-y"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveManualSummary}
                      disabled={manualSummarySaving || !manualSummaryText.trim()}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors disabled:opacity-60"
                    >
                      {manualSummarySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {manualSummarySaving ? '保存中...' : '保存并索引'}
                    </button>
                    <button
                      onClick={() => { setManualSummaryOpen(false); setManualSummaryText(''); }}
                      disabled={manualSummarySaving}
                      className="inline-flex items-center px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors disabled:opacity-60"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {permissionOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3 backdrop-blur-sm md:p-6" onMouseDown={() => !permissionSaving && setPermissionOpen(false)}>
          <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-4 md:px-6 md:py-5">
              <div><div className="mb-1 flex items-center gap-2 text-sm font-semibold text-blue-600"><ShieldCheck className="h-4 w-4" />文件访问权限</div><h2 className="max-w-xl truncate text-xl font-bold text-slate-900">{file.original_name}</h2></div>
              <button onClick={() => setPermissionOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            {permissionLoading ? <div className="grid h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div> : (
              <div className="space-y-5 p-4 md:p-6">
                {permissionError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{permissionError}</div>}
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-800">
                  {permissionRules.length ? '该文件正在使用独立权限。' : filePermissions?.inherited_from_folder_name ? `当前继承自“${filePermissions.inherited_from_folder_name.replace(/王朝/g, '王潮')}”。不添加独立对象即可继续继承。` : '当前沿用目录的默认访问范围。'}
                </div>
                <button onClick={() => togglePermissionRule('all')} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left ${hasPermissionRule('all') ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}><span className="flex items-center gap-3"><Building2 className="h-5 w-5 text-blue-500" /><span><span className="block font-semibold text-slate-800">整个集团可见</span><span className="text-xs text-slate-500">所有成员均可在线查看，普通用户仍不可下载</span></span></span>{hasPermissionRule('all') && <Check className="h-5 w-5 text-blue-600" />}</button>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex items-center gap-2 font-semibold text-slate-700"><UsersRound className="h-4 w-4 text-cyan-500" />钉钉部门</div><div className="max-h-52 space-y-1 overflow-y-auto">{(filePermissions?.available_org_units || []).map((path) => <button key={path} onClick={() => togglePermissionRule('org', path)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${hasPermissionRule('org', path) ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-50'}`}><span className="truncate">{path}</span>{hasPermissionRule('org', path) && <Check className="h-4 w-4" />}</button>)}</div></div>
                  <div className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex items-center gap-2 font-semibold text-slate-700"><UserRound className="h-4 w-4 text-amber-500" />指定人员</div><input value={permissionUserQuery} onChange={(event) => setPermissionUserQuery(event.target.value)} placeholder="搜索姓名或部门" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" /><div className="max-h-40 space-y-1 overflow-y-auto">{(filePermissions?.candidate_users || []).filter((candidate) => `${candidate.name} ${candidate.department_name || ''}`.includes(permissionUserQuery.trim())).slice(0, 60).map((candidate) => <button key={candidate.id} onClick={() => togglePermissionRule('user', String(candidate.id))} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${hasPermissionRule('user', String(candidate.id)) ? 'bg-amber-50 text-amber-700' : 'text-slate-500 hover:bg-slate-50'}`}><span className="truncate">{candidate.name}<span className="ml-2 text-xs text-slate-400">{candidate.department_name}</span></span>{hasPermissionRule('user', String(candidate.id)) && <Check className="h-4 w-4" />}</button>)}</div></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><button onClick={() => setPermissionRules([])} className="text-sm font-medium text-slate-500 hover:text-slate-700">恢复继承</button><div className="flex gap-2"><button onClick={() => setPermissionOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">取消</button><button onClick={() => void saveFilePermissions()} disabled={permissionSaving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{permissionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存</button></div></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FilePreview;
