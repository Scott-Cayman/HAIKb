import api from './api';

export const INTERNAL_RESOURCE_DRAG_TYPE = 'application/x-haikb-resource';

export type MovableResourceKind = 'file' | 'folder';

export type MovableResource = {
  kind: MovableResourceKind;
  id: number;
  name: string;
};

export type MoveTarget = {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  depth: number;
  can_select: boolean;
  disabled_reason?: string | null;
};

export type MoveTargetsResponse = {
  root_folder_id: number;
  targets: MoveTarget[];
};

export const getMoveTargets = async (resource: MovableResource) => {
  const response = await api.get<MoveTargetsResponse>('/folders/move-targets', {
    params: { resource_type: resource.kind, resource_id: resource.id },
  });
  return response.data;
};

export const moveResource = async (resource: MovableResource, targetFolderId: number) => {
  const response = await api.post(`/${resource.kind === 'file' ? 'files' : 'folders'}/${resource.id}/move`, {
    target_folder_id: targetFolderId,
  });
  return response.data;
};

export const writeResourceDragData = (dataTransfer: DataTransfer, resource: MovableResource) => {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(INTERNAL_RESOURCE_DRAG_TYPE, JSON.stringify(resource));
  dataTransfer.setData('text/plain', resource.name);
};

export const readResourceDragData = (dataTransfer: DataTransfer): MovableResource | null => {
  const raw = dataTransfer.getData(INTERNAL_RESOURCE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MovableResource>;
    if ((parsed.kind === 'file' || parsed.kind === 'folder') && Number.isInteger(parsed.id) && parsed.name) {
      return { kind: parsed.kind, id: Number(parsed.id), name: String(parsed.name) };
    }
  } catch {
    return null;
  }
  return null;
};

export const hasResourceDragData = (dataTransfer: DataTransfer) =>
  Array.from(dataTransfer.types).includes(INTERNAL_RESOURCE_DRAG_TYPE);

export const isExternalFileDrag = (dataTransfer: DataTransfer) => {
  const types = Array.from(dataTransfer.types);
  return types.includes('Files') && !types.includes(INTERNAL_RESOURCE_DRAG_TYPE);
};
