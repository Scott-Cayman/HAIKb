const SUPPORTED_FILE_ICON_NAMES = new Set([
  'ai',
  'audio',
  'book',
  'camera',
  'excel',
  'folder',
  'image',
  'mat',
  'max',
  'markdown',
  'pdf',
  'ppt',
  'psd',
  'question-bank',
  'skm',
  'skp',
  'txt',
  'video',
  'word',
  'zip',
]);

const FILE_ICON_ALIAS_MAP: Record<string, string> = {
  // Office 文档统一归并到设计好的主图标。
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  csv: 'excel',
  pptx: 'ppt',

  // 常见文本和 PDF。
  md: 'markdown',
  markdown: 'markdown',
  log: 'txt',
  text: 'txt',

  // 图片类统一走 image.svg。
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  ico: 'image',
  heic: 'image',

  // 视频类统一走 video.svg。
  mp4: 'video',
  avi: 'video',
  mov: 'video',
  mkv: 'video',
  wmv: 'video',
  webm: 'video',
  m4v: 'video',

  // 音频类统一走 audio.svg。
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',

  // 压缩包统一走 zip.svg。
  rar: 'zip',
  '7z': 'zip',
  tar: 'zip',
  gz: 'zip',
  bz2: 'zip',
  xz: 'zip',
};

export const getFileExtension = (fileName?: string | null) => {
  if (!fileName) return '';

  const normalizedName = fileName.trim();
  const lastDotIndex = normalizedName.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === normalizedName.length - 1) {
    return '';
  }

  return normalizedName.slice(lastDotIndex + 1).toLowerCase();
};

export const getFileIconName = (fileName?: string | null) => {
  const extension = getFileExtension(fileName);

  if (!extension) return null;
  if (SUPPORTED_FILE_ICON_NAMES.has(extension)) return extension;

  const alias = FILE_ICON_ALIAS_MAP[extension];
  return alias && SUPPORTED_FILE_ICON_NAMES.has(alias) ? alias : null;
};

export const getFileIconSrc = (fileName?: string | null) => {
  const iconName = getFileIconName(fileName);
  return iconName ? `/IconSvg/${iconName}.svg` : null;
};
