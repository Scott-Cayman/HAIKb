import { useEffect, useMemo, useState } from 'react';
import { File } from 'lucide-react';

import { getFileIconSrc } from '../../config/fileIcons';

type FileIconBadgeProps = {
  fileName?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  alt?: string;
};

const FileIconBadge = ({
  fileName,
  className = 'flex h-10 w-10 items-center justify-center',
  imageClassName = 'block h-full w-full object-contain',
  fallbackClassName = 'h-5 w-5 text-slate-400',
  alt,
}: FileIconBadgeProps) => {
  const iconSrc = useMemo(() => getFileIconSrc(fileName), [fileName]);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  useEffect(() => {
    setImageLoadFailed(false);
  }, [iconSrc]);

  if (!iconSrc || imageLoadFailed) {
    return (
      <div className={className}>
        <File className={fallbackClassName} />
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={iconSrc}
        alt={alt || fileName || 'file icon'}
        className={imageClassName}
        loading="lazy"
        onError={() => setImageLoadFailed(true)}
      />
    </div>
  );
};

export default FileIconBadge;
