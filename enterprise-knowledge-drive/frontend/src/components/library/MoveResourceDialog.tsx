import { FolderInput, Loader2, Search, X } from 'lucide-react';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  getMoveTargets,
  moveResource,
  type MovableResource,
  type MoveTarget,
} from '../../services/resourceMove';

type MoveResourceDialogProps = {
  resource: MovableResource;
  initialTargetFolderId?: number | null;
  onClose: () => void;
  onMoved: (resource: MovableResource, target: MoveTarget) => void | Promise<void>;
};

const requestErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

const MoveResourceDialog = ({
  resource,
  initialTargetFolderId,
  onClose,
  onMoved,
}: MoveResourceDialogProps) => {
  const [targets, setTargets] = useState<MoveTarget[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(initialTargetFolderId ?? null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMoveTargets(resource)
      .then((result) => {
        if (!active) return;
        setTargets(result.targets);
        if (initialTargetFolderId) {
          const preset = result.targets.find((target) => target.id === initialTargetFolderId && target.can_select);
          setSelectedId(preset?.id ?? null);
          if (!preset) setError('该文件夹当前不能作为移动目标');
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestErrorMessage(requestError, '加载可移动目录失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialTargetFolderId, resource]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !moving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moving, onClose]);

  const visibleTargets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return targets;
    return targets.filter((target) => target.path.toLocaleLowerCase().includes(normalized));
  }, [query, targets]);

  const selectedTarget = targets.find((target) => target.id === selectedId) || null;

  const confirmMove = async () => {
    if (!selectedTarget?.can_select || moving) return;
    setMoving(true);
    setError(null);
    try {
      await moveResource(resource, selectedTarget.id);
      await onMoved(resource, selectedTarget);
      onClose();
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, '移动失败，请稍后重试'));
    } finally {
      setMoving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !moving) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="move-resource-title" className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <h2 id="move-resource-title" className="text-lg font-semibold text-slate-900">移动{resource.kind === 'folder' ? '文件夹' : '文件'}</h2>
            <p className="mt-1 truncate text-sm text-slate-500" title={resource.name}>{resource.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={moving} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-100 px-6 py-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 focus-within:border-[#5bcfc2] focus-within:bg-white">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目标文件夹" className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none" autoFocus />
          </label>
        </div>

        <div className="min-h-[260px] flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex h-56 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在加载目录...</div>
          ) : visibleTargets.length ? (
            <div className="space-y-1">
              {visibleTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  disabled={!target.can_select}
                  onClick={() => {
                    setSelectedId(target.id);
                    setError(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                    selectedId === target.id
                      ? 'bg-[#e9fbf7] text-[#168f83] ring-1 ring-[#7cddd2]'
                      : target.can_select
                        ? 'text-slate-700 hover:bg-slate-50'
                        : 'cursor-not-allowed bg-slate-50/60 text-slate-300'
                  }`}
                >
                  <FolderInput className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{target.name}</span>
                    <span className="block truncate text-xs opacity-70" title={target.path}>{target.path}</span>
                  </span>
                  {target.disabled_reason ? <span className="shrink-0 text-xs">{target.disabled_reason}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center text-sm text-slate-400">没有匹配的目标文件夹</div>
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-5">
          {selectedTarget ? <p className="mb-3 truncate text-xs text-slate-500">将移动到：{selectedTarget.path}</p> : null}
          <p className="mb-4 text-xs text-amber-600">移动后将继承目标目录权限；资源单独配置的权限保持不变。</p>
          {error ? <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={moving} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">取消</button>
            <button type="button" onClick={() => void confirmMove()} disabled={!selectedTarget?.can_select || moving} className="inline-flex min-w-24 items-center justify-center gap-2 rounded-xl bg-[#31bfb0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#27aa9d] disabled:cursor-not-allowed disabled:opacity-50">
              {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{moving ? '移动中...' : '确认移动'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default MoveResourceDialog;
