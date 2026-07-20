import { MoreVertical, PencilLine, Trash2 } from 'lucide-react';

type InlineItemMenuProps = {
  isOpen: boolean;
  canRename: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
};

const InlineItemMenu = ({
  isOpen,
  canRename,
  canDelete,
  onToggle,
  onRename,
  onDelete,
}: InlineItemMenuProps) => {
  const actionCount = Number(canRename) + Number(canDelete);
  if (actionCount === 0) return null;

  const expandedWidth = actionCount === 2 ? 'w-[92px]' : 'w-[60px]';
  const triggerShift = actionCount === 2 ? '-translate-x-16' : '-translate-x-8';

  return (
    <div
      className={`relative h-7 shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        isOpen ? expandedWidth : 'w-7'
      }`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? '收起操作' : '更多操作'}
        title={isOpen ? '收起操作' : '更多操作'}
        onClick={onToggle}
        className={`absolute right-0 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full transition-[transform,color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          isOpen ? `${triggerShift} bg-slate-100 text-slate-700` : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <MoreVertical className={`h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      <div
        className={`absolute right-0 top-0 flex origin-right items-center gap-1 transition-[transform,opacity] duration-200 motion-reduce:transition-none ${
          isOpen ? 'translate-x-0 scale-100 opacity-100' : 'pointer-events-none translate-x-2 scale-90 opacity-0'
        }`}
      >
        {canRename ? (
          <button
            type="button"
            aria-label="重命名"
            title="重命名"
            aria-hidden={!isOpen}
            tabIndex={isOpen ? 0 : -1}
            onClick={onRename}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
          >
            <PencilLine className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            aria-label="删除"
            title="删除"
            aria-hidden={!isOpen}
            tabIndex={isOpen ? 0 : -1}
            onClick={onDelete}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default InlineItemMenu;
