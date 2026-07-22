import { Folder, Grid2X2, List } from 'lucide-react';
import { useRef, useState, type DragEvent, type MouseEvent } from 'react';

import FavoriteButton from '../FavoriteButton';
import FileIconBadge from '../files/FileIconBadge';
import FilePreviewThumbnail from '../files/FilePreviewThumbnail';
import FolderIconBadge from '../folders/FolderIconBadge';
import type { CollectionItem, CollectionStatusTone, CollectionViewMode } from './types';
import { hasResourceDragData, readResourceDragData, writeResourceDragData } from '../../services/resourceMove';

type SortableHeaderConfig = {
  label: string;
  onClick?: () => void;
  direction?: 'asc' | 'desc' | null;
};

type ColumnConfig = SortableHeaderConfig | false;

type LibraryItemsViewProps = {
  items: CollectionItem[];
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  itemCountLabel?: string;
  emptyState?: React.ReactNode;
  showHeader?: boolean;
  className?: string;
  gridClassName?: string;
  nameColumn?: SortableHeaderConfig;
  secondaryColumn?: ColumnConfig;
  sizeColumn?: ColumnConfig;
  statusColumn?: ColumnConfig;
  dateColumn?: ColumnConfig;
  actionColumnLabel?: string;
};

const DEFAULT_NAME_COLUMN: SortableHeaderConfig = { label: '名称' };
const DEFAULT_SECONDARY_COLUMN: SortableHeaderConfig = { label: '附加信息' };
const DEFAULT_SIZE_COLUMN: SortableHeaderConfig = { label: '大小' };
const DEFAULT_STATUS_COLUMN: SortableHeaderConfig = { label: '状态' };
const DEFAULT_DATE_COLUMN: SortableHeaderConfig = { label: '时间' };

const getStatusClassName = (tone: CollectionStatusTone = 'neutral') => {
  if (tone === 'success') {
    return 'bg-emerald-50 text-emerald-500';
  }
  if (tone === 'warning') {
    return 'bg-amber-50 text-amber-500';
  }
  return 'bg-slate-100 text-slate-500';
};

const getFavoriteButtonVisibility = () => 'opacity-100';

const inferFileExt = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(dotIndex).toLowerCase();
};

const truncateText = (text: string, maxLength: number) => {
  const chars = Array.from(text);

  if (chars.length <= maxLength) {
    return text;
  }

  return `${chars.slice(0, maxLength).join('')}...`;
};

const renderHeaderLabel = (config: SortableHeaderConfig) => (
  <>
    {config.label}
    {config.direction ? ` ${config.direction === 'asc' ? '↑' : '↓'}` : ''}
  </>
);

const HeaderCell = ({ config, className = '' }: { config: SortableHeaderConfig; className?: string }) => {
  if (!config.onClick) {
    return <span className={`inline-flex items-center justify-center ${className}`}>{renderHeaderLabel(config)}</span>;
  }

  return (
    <button
      type="button"
      onClick={config.onClick}
      className={`inline-flex items-center justify-center text-center transition-colors hover:text-slate-600 ${className}`}
    >
      {renderHeaderLabel(config)}
    </button>
  );
};

const ItemVisual = ({ item, listMode = false }: { item: CollectionItem; listMode?: boolean }) => {
  if (item.kind === 'folder') {
    return (
      <FolderIconBadge
        iconKey={item.iconKey}
        iconBgFrom={item.iconBgFrom}
        iconBgTo={item.iconBgTo}
        iconColor={item.iconColor}
        className={listMode ? 'h-10 w-10 rounded-2xl' : 'h-14 w-14 rounded-[18px]'}
        iconClassName={listMode ? 'h-5 w-5' : 'h-7 w-7'}
      />
    );
  }

  if (listMode) {
    return (
      <FileIconBadge
        fileName={item.name}
        className="flex h-10 w-10 shrink-0 items-center justify-center"
        imageClassName="block h-10 w-10 object-contain"
        fallbackClassName="h-6 w-6 text-slate-400"
      />
    );
  }

  return (
    <div className="relative mb-3 h-[104px] overflow-hidden rounded-2xl">
      <div className="h-full w-full">
        <FilePreviewThumbnail
          fileId={Number(item.id)}
          fileName={item.name}
          fileExt={item.fileExt || inferFileExt(item.name)}
          previewStatus={item.previewStatus}
          thumbnailStatus={item.thumbnailStatus}
          className="flex h-full w-full items-center justify-center"
          imageClassName="h-full w-full"
          fallbackClassName="h-10 w-10 text-slate-400"
          smartFit
        />
      </div>
    </div>
  );
};

const SecondaryContent = ({ item }: { item: CollectionItem }) => {
  if (item.folderLink) {
    return (
      <button
        type="button"
        onClick={item.folderLink.onClick}
        title={item.folderLink.title || item.folderLink.label}
        className="inline-flex max-w-full items-center justify-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-[#34b8aa]"
      >
        <Folder className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.folderLink.label}</span>
      </button>
    );
  }

  const text = item.secondaryLabel || item.description;
  const title = item.secondaryTitle || text || undefined;

  if (!text) {
    return <span className="text-slate-300">-</span>;
  }

  return (
    <span className="truncate" title={title}>
      {text}
    </span>
  );
};

const ItemActions = ({
  item,
  compact = false,
  showFavorite = true,
}: {
  item: CollectionItem;
  compact?: boolean;
  showFavorite?: boolean;
}) => {
  if ((!showFavorite || !item.favorite) && !item.action && !item.menu) {
    return null;
  }

  return (
    <div className={`inline-flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
      {showFavorite && item.favorite ? (
        <FavoriteButton
          active={item.favorite.active}
          title={item.favorite.title}
          className={`${compact ? 'h-8 w-8 rounded-full' : 'h-9 w-9 rounded-full'} ${getFavoriteButtonVisibility()}`}
          onClick={item.favorite.onClick}
        />
      ) : null}
      {item.action ? (
        <button
          type="button"
          onClick={item.action.onClick}
          className={`rounded-full font-semibold transition-opacity ${compact ? 'px-4 py-2 text-sm' : 'px-4 py-2 text-sm'}`}
          style={{
            backgroundColor: '#eefcf8',
            color: '#34b8aa',
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      {item.menu}
    </div>
  );
};

const useCollectionItemDrag = (item: CollectionItem) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const suppressOpenRef = useRef(false);
  const move = item.move;
  const draggable = !!move?.enabled;
  const canAcceptDrop = item.kind === 'folder' && !!move?.canAcceptDrop && !!move.onDrop;

  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (suppressOpenRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    item.onOpen();
  };

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    if (!draggable || !move) {
      event.preventDefault();
      return;
    }
    writeResourceDragData(event.dataTransfer, move.resource);
    setIsDragging(true);
    suppressOpenRef.current = true;
  };

  const onDragEnd = () => {
    setIsDragging(false);
    setIsDropActive(false);
    window.setTimeout(() => {
      suppressOpenRef.current = false;
    }, 0);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!canAcceptDrop || !hasResourceDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsDropActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDropActive(false);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!canAcceptDrop || !hasResourceDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
    const source = readResourceDragData(event.dataTransfer);
    if (!source || (source.kind === 'folder' && source.id === Number(item.id))) return;
    move?.onDrop?.(source, Number(item.id));
  };

  return {
    draggable,
    isDragging,
    isDropActive,
    onClick,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
};

const GridCard = ({ item }: { item: CollectionItem }) => {
  const footerDate = item.dateLabel || null;
  const footerSize = item.sizeLabel || null;
  const drag = useCollectionItemDrag(item);

  return (
    <div
      draggable={drag.draggable}
      onClick={drag.onClick}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
      className={`group cursor-pointer rounded-[20px] border bg-white p-3 transition-all hover:-translate-y-px hover:shadow-[0_7px_16px_rgba(178,200,220,0.1)] ${
        drag.isDropActive
          ? 'border-[#43c9bb] bg-[#effcf9] ring-2 ring-[#b9eee7]'
          : 'border-slate-100 hover:border-[#d9ece8]'
      } ${drag.isDragging ? 'opacity-45' : ''} ${drag.draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {drag.isDropActive ? <div className="mb-2 rounded-lg bg-[#dff8f3] px-2 py-1 text-center text-xs font-medium text-[#168f83]">移动到此文件夹</div> : null}
      {item.kind === 'folder' ? (
        <div className="relative mb-3 flex h-[104px] items-center justify-center rounded-[18px]">
          <ItemVisual item={item} />
          {item.favorite ? (
            <div className="absolute right-2.5 top-2.5">
              <FavoriteButton
                active={item.favorite.active}
                title={item.favorite.title}
                className={`h-8 w-8 rounded-full ${getFavoriteButtonVisibility()}`}
                onClick={item.favorite.onClick}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <ItemVisual item={item} />
          {item.favorite ? (
            <div className="absolute right-3 top-3">
              <FavoriteButton
                active={item.favorite.active}
                title={item.favorite.title}
                className={`h-8 w-8 rounded-full ${getFavoriteButtonVisibility()}`}
                onClick={item.favorite.onClick}
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="space-y-1">
        <div
          className={`text-sm font-semibold leading-6 text-slate-800 transition-colors group-hover:text-[#34b8aa] ${
            item.kind === 'folder' ? 'truncate text-center' : 'min-h-[40px] line-clamp-2'
          }`}
          title={item.name}
        >
          {item.name}
        </div>

        {item.folderLink || item.secondaryLabel || item.description ? (
          <div className={`text-xs text-slate-400 ${item.kind === 'folder' ? 'text-center' : ''}`}>
            <SecondaryContent item={item} />
          </div>
        ) : null}

        {footerDate || footerSize || item.action || item.menu ? (
          <div className="mt-1.5 flex h-8 items-center gap-1 border-t border-slate-100/80 pt-1.5">
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden text-[9.5px] text-slate-400">
              {footerDate ? <span className="truncate">{footerDate}</span> : <span />}
              {footerSize ? <span className="shrink-0 whitespace-nowrap text-right">{footerSize}</span> : null}
            </div>
            {item.action || item.menu ? <ItemActions item={item} compact showFavorite={false} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const ListRow = ({
  item,
  showSecondaryColumn,
  showSizeColumn,
  showStatusColumn,
  showDateColumn,
}: {
  item: CollectionItem;
  showSecondaryColumn: boolean;
  showSizeColumn: boolean;
  showStatusColumn: boolean;
  showDateColumn: boolean;
}) => {
  const drag = useCollectionItemDrag(item);
  return (
  <tr
    draggable={drag.draggable}
    onClick={drag.onClick}
    onDragStart={drag.onDragStart}
    onDragEnd={drag.onDragEnd}
    onDragOver={drag.onDragOver}
    onDragLeave={drag.onDragLeave}
    onDrop={drag.onDrop}
    className={`group cursor-pointer transition-colors ${drag.isDropActive ? 'bg-[#e9fbf7] ring-1 ring-inset ring-[#6dd8cc]' : 'hover:bg-[#fbfefe]'} ${drag.isDragging ? 'opacity-45' : ''} ${drag.draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
  >
    <td className="px-5 py-3 align-middle">
      <div className="flex items-center justify-start gap-3">
        <ItemVisual item={item} listMode />
        <span
          className="max-w-[220px] truncate text-left font-semibold text-slate-700 transition-colors group-hover:text-[#34b8aa] sm:max-w-xs"
          title={item.name}
        >
          {truncateText(item.name, 25)}
        </span>
      </div>
    </td>

    {showSecondaryColumn ? (
      <td className="px-5 py-3 text-center align-middle text-slate-500">
        <SecondaryContent item={item} />
      </td>
    ) : null}

    {showSizeColumn ? (
      <td className="hidden px-5 py-3 text-center align-middle text-slate-500 sm:table-cell">{item.sizeLabel || '-'}</td>
    ) : null}

    {showStatusColumn ? (
      <td className="hidden px-5 py-3 text-center align-middle md:table-cell">
        {item.statusLabel ? (
          <span className={`inline-flex rounded px-2 py-1 text-xs ${getStatusClassName(item.statusTone)}`}>
            {item.statusLabel}
          </span>
        ) : (
          <span className="text-slate-300">-</span>
        )}
      </td>
    ) : null}

    {showDateColumn ? (
      <td className="hidden px-5 py-3 text-center align-middle text-slate-500 md:table-cell">{item.dateLabel || '-'}</td>
    ) : null}

    <td className="px-5 py-3 text-center align-middle">
      <div className="flex justify-center">
        <ItemActions item={item} />
      </div>
    </td>
  </tr>
  );
};

const resolveColumn = (
  config: ColumnConfig | undefined,
  fallback: SortableHeaderConfig,
  visible: boolean,
) => {
  if (config === false || !visible) {
    return null;
  }

  return config || fallback;
};

const LibraryItemsView = ({
  items,
  viewMode,
  onViewModeChange,
  itemCountLabel,
  emptyState,
  showHeader = true,
  className = '',
  gridClassName = 'grid gap-3 p-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))] md:gap-4 md:p-5 md:[grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]',
  nameColumn = DEFAULT_NAME_COLUMN,
  secondaryColumn,
  sizeColumn,
  statusColumn,
  dateColumn,
  actionColumnLabel = '操作',
}: LibraryItemsViewProps) => {
  const hasSecondaryContent = items.some((item) => item.folderLink || item.secondaryLabel || item.description);
  const hasSizeContent = items.some((item) => item.sizeLabel);
  const hasStatusContent = items.some((item) => item.statusLabel);
  const hasDateContent = items.some((item) => item.dateLabel);

  const resolvedSecondaryColumn = resolveColumn(secondaryColumn, DEFAULT_SECONDARY_COLUMN, hasSecondaryContent);
  const resolvedSizeColumn = resolveColumn(sizeColumn, DEFAULT_SIZE_COLUMN, hasSizeContent);
  const resolvedStatusColumn = resolveColumn(statusColumn, DEFAULT_STATUS_COLUMN, hasStatusContent);
  const resolvedDateColumn = resolveColumn(dateColumn, DEFAULT_DATE_COLUMN, hasDateContent);

  const content = items.length ? (
    viewMode === 'list' ? (
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-[#fbfdff] text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <th className="sticky top-0 z-10 bg-[#fbfdff] px-5 py-4 text-left font-medium">
              <HeaderCell config={nameColumn} className="justify-start text-left" />
            </th>
            {resolvedSecondaryColumn ? (
              <th className="sticky top-0 z-10 bg-[#fbfdff] px-5 py-4 text-center font-medium">
                <HeaderCell config={resolvedSecondaryColumn} />
              </th>
            ) : null}
            {resolvedSizeColumn ? (
              <th className="sticky top-0 z-10 hidden bg-[#fbfdff] px-5 py-4 text-center font-medium sm:table-cell">
                <HeaderCell config={resolvedSizeColumn} />
              </th>
            ) : null}
            {resolvedStatusColumn ? (
              <th className="sticky top-0 z-10 hidden bg-[#fbfdff] px-5 py-4 text-center font-medium md:table-cell">
                <HeaderCell config={resolvedStatusColumn} />
              </th>
            ) : null}
            {resolvedDateColumn ? (
              <th className="sticky top-0 z-10 hidden bg-[#fbfdff] px-5 py-4 text-center font-medium md:table-cell">
                <HeaderCell config={resolvedDateColumn} />
              </th>
            ) : null}
            <th className="sticky top-0 z-10 bg-[#fbfdff] px-5 py-4 text-center font-medium">{actionColumnLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 text-sm">
          {items.map((item) => (
            <ListRow
              key={`${item.kind}-${item.id}`}
              item={item}
              showSecondaryColumn={!!resolvedSecondaryColumn}
              showSizeColumn={!!resolvedSizeColumn}
              showStatusColumn={!!resolvedStatusColumn}
              showDateColumn={!!resolvedDateColumn}
            />
          ))}
        </tbody>
      </table>
    ) : (
      <div className={gridClassName}>
        {items.map((item) => (
          <GridCard key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </div>
    )
  ) : (
    emptyState || (
      <div className="p-12 text-center text-slate-500">暂无内容</div>
    )
  );

  return (
    <div className={`min-h-0 min-w-0 flex flex-col overflow-hidden ${className}`}>
      {showHeader ? (
        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-slate-100 bg-white p-3 md:p-4">
          <p className="text-sm text-slate-500">{itemCountLabel || `${items.length} 个项目`}</p>
          <div className="flex items-center space-x-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              onMouseDown={(event) => event.stopPropagation()}
              className={`rounded-md p-1.5 transition-colors ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="列表视图"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              onMouseDown={(event) => event.stopPropagation()}
              className={`rounded-md p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="宫格视图"
            >
              <Grid2X2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
    </div>
  );
};

export default LibraryItemsView;
