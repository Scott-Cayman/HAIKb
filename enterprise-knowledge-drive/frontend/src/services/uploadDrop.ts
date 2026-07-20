export type UploadCandidate = {
  file: File;
  relativePath: string;
};

export type DroppedUploadPayload = {
  files: UploadCandidate[];
  directories: string[];
};

type LegacyFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
};

type LegacyDirectoryReader = {
  readEntries: (
    success: (entries: LegacyFileSystemEntry[]) => void,
    failure?: (error: DOMException) => void,
  ) => void;
};

type LegacyDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => LegacyDirectoryReader;
};

type LegacyFileSystemEntry = LegacyFileEntry | LegacyDirectoryEntry;

const normalizeRelativePath = (value: string) => {
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('文件夹路径无效');
  }
  return parts.join('/');
};

const readFileEntry = (entry: LegacyFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readDirectoryEntries = async (entry: LegacyDirectoryEntry) => {
  const reader = entry.createReader();
  const entries: LegacyFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
};

const walkEntry = async (
  entry: LegacyFileSystemEntry,
  parentPath: string,
  result: DroppedUploadPayload,
) => {
  const relativePath = normalizeRelativePath([parentPath, entry.name].filter(Boolean).join('/'));
  if (entry.isFile) {
    const file = await readFileEntry(entry);
    result.files.push({ file, relativePath });
    return;
  }

  result.directories.push(relativePath);
  const children = await readDirectoryEntries(entry);
  for (const child of children) {
    await walkEntry(child, relativePath, result);
  }
};

const uniqueSortedDirectories = (directories: string[]) =>
  Array.from(new Set(directories.map(normalizeRelativePath).filter(Boolean))).sort((left, right) => {
    const depthDifference = left.split('/').length - right.split('/').length;
    return depthDifference || left.localeCompare(right, 'zh-CN');
  });

export const createUploadCandidates = (files: FileList | File[]) =>
  Array.from(files).map((file) => ({
    file,
    relativePath: normalizeRelativePath(file.webkitRelativePath || file.name),
  }));

export const deriveDirectoryPaths = (files: UploadCandidate[]) => {
  const directories: string[] = [];
  files.forEach(({ relativePath }) => {
    const parts = normalizeRelativePath(relativePath).split('/').slice(0, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      directories.push(parts.slice(0, index).join('/'));
    }
  });
  return uniqueSortedDirectories(directories);
};

export const collectDroppedUpload = async (dataTransfer: DataTransfer): Promise<DroppedUploadPayload> => {
  const result: DroppedUploadPayload = { files: [], directories: [] };
  const entries = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const legacyItem = item as unknown as {
        webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
      };
      return legacyItem.webkitGetAsEntry?.() || null;
    })
    .filter((entry): entry is LegacyFileSystemEntry => entry !== null);

  if (entries.length > 0) {
    for (const entry of entries) {
      await walkEntry(entry, '', result);
    }
  } else {
    result.files = createUploadCandidates(dataTransfer.files);
  }

  const seenFiles = new Set<string>();
  result.files = result.files.filter(({ file, relativePath }) => {
    const key = `${relativePath}:${file.size}:${file.lastModified}`;
    if (seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });
  result.directories = uniqueSortedDirectories([
    ...result.directories,
    ...deriveDirectoryPaths(result.files),
  ]);
  return result;
};
