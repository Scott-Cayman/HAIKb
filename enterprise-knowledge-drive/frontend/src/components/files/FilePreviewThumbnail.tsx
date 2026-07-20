import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '../../services/backendConfig';
import FileIconBadge from './FileIconBadge';

const THUMBNAIL_EXTENSIONS = new Set([
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.webm', '.ogg', '.mov',
]);

const inferExtension = (fileName?: string | null) => {
  const normalized = (fileName || '').trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
};

type FilePreviewThumbnailProps = {
  fileId: number;
  fileName?: string | null;
  fileExt?: string | null;
  previewStatus?: string | null;
  thumbnailStatus?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  smartFit?: boolean;
};

const FilePreviewThumbnail = ({
  fileId,
  fileName,
  fileExt,
  thumbnailStatus,
  className,
  imageClassName,
  fallbackClassName,
  smartFit = false,
}: FilePreviewThumbnailProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isTallPortrait, setIsTallPortrait] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState(thumbnailStatus || 'pending');
  const normalizedExtension = (fileExt || inferExtension(fileName)).toLowerCase();
  const supportsThumbnail = THUMBNAIL_EXTENSIONS.has(normalizedExtension);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fileId]);

  useEffect(() => {
    setLoadFailed(false);
    setIsTallPortrait(false);
    setRuntimeStatus(supportsThumbnail ? (thumbnailStatus || 'pending') : 'unsupported');
    setThumbnailUrl((currentUrl) => {
      if (currentUrl) window.URL.revokeObjectURL(currentUrl);
      return null;
    });

    if (!isVisible || !supportsThumbnail) return;

    const controller = new AbortController();
    let retryTimer: number | null = null;
    let attempt = 0;

    const loadThumbnail = async () => {
      try {
        attempt += 1;
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/files/${fileId}/thumbnail`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
          cache: 'default',
        });

        if (response.status === 202) {
          const payload = await response.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          setRuntimeStatus(payload.thumbnail_status || 'processing');
          const retryAfterValue = Number(payload.retry_after || response.headers.get('Retry-After') || 2);
          const retryAfterSeconds = Number.isFinite(retryAfterValue) ? Math.max(1, retryAfterValue) : 2;
          if (attempt < 180) {
            retryTimer = window.setTimeout(loadThumbnail, Math.min(retryAfterSeconds, 5) * 1000);
          }
          return;
        }

        if (response.status === 415) {
          setRuntimeStatus('unsupported');
          return;
        }

        if (response.status === 422) {
          setRuntimeStatus('failed');
          setLoadFailed(true);
          return;
        }

        if (!response.ok) throw new Error(`thumbnail request failed: ${response.status}`);

        const blob = await response.blob();
        if (controller.signal.aborted) return;
        setRuntimeStatus('success');
        setThumbnailUrl(window.URL.createObjectURL(blob));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to load file thumbnail', error);
          if (attempt < 3) {
            retryTimer = window.setTimeout(loadThumbnail, 1500 * attempt);
          } else {
            setLoadFailed(true);
          }
        }
      }
    };
    loadThumbnail();
    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [fileId, isVisible, supportsThumbnail, thumbnailStatus]);

  useEffect(
    () => () => {
      if (thumbnailUrl) window.URL.revokeObjectURL(thumbnailUrl);
    },
    [thumbnailUrl],
  );

  const isGenerating = runtimeStatus === 'pending' || runtimeStatus === 'processing';
  const showImage = runtimeStatus === 'success' && thumbnailUrl && !loadFailed;

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      {showImage ? (
        <img
          src={thumbnailUrl}
          alt={fileName ? `${fileName} 封面` : '文件封面'}
          className={`${imageClassName || ''} ${
            smartFit
              ? isTallPortrait
                ? 'object-cover'
                : 'object-contain p-2.5'
              : ''
          }`}
          loading="lazy"
          onLoad={(event) => {
            if (!smartFit) return;
            const { naturalHeight, naturalWidth } = event.currentTarget;
            setIsTallPortrait(naturalHeight / Math.max(naturalWidth, 1) > 1.6);
          }}
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <FileIconBadge
          fileName={fileName}
          className="flex h-full w-full items-center justify-center"
          imageClassName={smartFit ? 'block h-11 w-11 object-contain' : imageClassName}
          fallbackClassName={fallbackClassName}
        />
      )}

      {isGenerating ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/55 to-transparent px-3 pb-2 pt-6 text-center text-[11px] font-medium text-white">
          正在生成封面
        </div>
      ) : null}
      {runtimeStatus === 'success' && !thumbnailUrl && !loadFailed ? (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-slate-100/55 motion-reduce:animate-none" />
      ) : null}
    </div>
  );
};

export default FilePreviewThumbnail;
