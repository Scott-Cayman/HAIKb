export const getKnowledgeFolderPath = (folderId: number | null | undefined): string => {
  return typeof folderId === 'number' && folderId > 0 ? `/folders/${folderId}` : '/';
};
