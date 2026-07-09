import { gradientToCss } from '../../config/homeAppearance';
import { getFolderIconComponent } from '../../config/folderVisuals';

type FolderIconBadgeProps = {
  iconKey?: string | null;
  iconBgFrom?: string | null;
  iconBgTo?: string | null;
  iconColor?: string | null;
  className?: string;
  iconClassName?: string;
};

const FolderIconBadge = ({
  iconKey,
  iconBgFrom,
  iconBgTo,
  iconColor,
  className = 'h-14 w-14 rounded-2xl',
  iconClassName = 'h-6 w-6',
}: FolderIconBadgeProps) => {
  const Icon = getFolderIconComponent(iconKey);

  return (
    <div
      className={`flex items-center justify-center shadow-[0_18px_28px_rgba(99,102,241,0.18)] ${className}`}
      style={{
        backgroundImage: gradientToCss({
          from: iconBgFrom || '#8cf3d5',
          to: iconBgTo || '#44d7cc',
        }),
      }}
    >
      <Icon className={iconClassName} style={{ color: iconColor || '#ffffff' }} />
    </div>
  );
};

export default FolderIconBadge;
