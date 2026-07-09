import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import { API_BASE_URL } from '../../services/backendConfig';
import FileIconBadge from './FileIconBadge';

type FilePreviewThumbnailProps = {
  fileId: number;
  fileName?: string | null;
  fileExt?: string | null;
  previewStatus?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
};

const IMAGE_PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const PDF_PREVIEW_EXTENSIONS = new Set(['.pdf', '.ppt', '.pptx', '.xls', '.xlsx']);

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const FilePreviewThumbnail = ({
  fileId,
  fileName,
  fileExt,
  previewStatus,
  className,
  imageClassName,
  fallbackClassName,
}: FilePreviewThumbnailProps) => {
  const normalizedExt = (fileExt || '').toLowerCase();
  const previewKind = useMemo<'image' | 'pdf' | null>(
    () => {
      if (previewStatus !== 'success') {
        return null;
      }
      if (IMAGE_PREVIEW_EXTENSIONS.has(normalizedExt)) {
        return 'image';
      }
      if (PDF_PREVIEW_EXTENSIONS.has(normalizedExt)) {
        return 'pdf';
      }
      return null;
    },
    [normalizedExt, previewStatus],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [containerWidth, setContainerWidth] = useState(240);

  useEffect(() => {
    setLoadFailed(false);
    setPreviewUrl((currentUrl) => {
      if (currentUrl) {
        window.URL.revokeObjectURL(currentUrl);
      }
      return null;
    });

    if (!previewKind) {
      return;
    }

    const controller = new AbortController();

    // 首页缩略图直接拉取 blob，避免 img 标签无法携带鉴权头的问题。
    const loadPreview = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/files/${fileId}/preview`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`preview request failed: ${response.status}`);
        }

        const blob = await response.blob();
        const nextUrl = window.URL.createObjectURL(blob);
        setPreviewUrl(nextUrl);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Failed to load file preview thumbnail', error);
        setLoadFailed(true);
      }
    };

    loadPreview();

    return () => {
      controller.abort();
    };
  }, [fileId, previewKind]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(node.clientWidth || 240);
    };

    updateWidth();
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!previewKind || loadFailed) {
    return (
      <FileIconBadge
        fileName={fileName}
        className={className}
        imageClassName={imageClassName}
        fallbackClassName={fallbackClassName}
      />
    );
  }

  return (
    <div ref={containerRef} className={className}>
      {!previewUrl ? (
        <div className="h-full w-full animate-pulse bg-slate-100" />
      ) : previewKind === 'image' ? (
        <img
          src={previewUrl}
          alt={fileName || 'file preview'}
          className={imageClassName}
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <Document
          file={previewUrl}
          loading={<div className="h-full w-full animate-pulse bg-slate-100" />}
          error={<FileIconBadge fileName={fileName} className={className} imageClassName={imageClassName} fallbackClassName={fallbackClassName} />}
          onLoadError={() => setLoadFailed(true)}
          className="flex h-full w-full items-center justify-center overflow-hidden"
        >
          <Page
            pageNumber={1}
            width={Math.max(containerWidth, 120)}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<div className="h-full w-full animate-pulse bg-slate-100" />}
            onLoadError={() => setLoadFailed(true)}
          />
        </Document>
      )}
    </div>
  );
};

export default FilePreviewThumbnail;
