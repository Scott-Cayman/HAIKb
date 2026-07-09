import { radialGlowToCss } from '../../config/homeAppearance';
import { resolveAssetUrl } from '../../config/folderVisuals';
import FolderIconBadge from '../folders/FolderIconBadge';

type FolderCoverArtProps = {
  displayMode: 'icon' | 'cover';
  imageUrl?: string;
  iconKey?: string;
  iconBgFrom?: string;
  iconBgTo?: string;
  iconColor: string;
  glowColor: string;
};

const FolderCoverArt = ({
  displayMode,
  imageUrl,
  iconKey,
  iconBgFrom,
  iconBgTo,
  iconColor,
  glowColor,
}: FolderCoverArtProps) => {
  if (displayMode === 'cover' && imageUrl) {
    return (
      <img
        src={resolveAssetUrl(imageUrl)}
        alt=""
        className="h-full w-full object-cover object-center"
      />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: radialGlowToCss(glowColor) }}
      />
      <div className="absolute bottom-4 left-1/2 h-16 w-24 -translate-x-1/2 rounded-full bg-white/30 blur-2xl" />
      <div className="absolute left-5 top-7 h-20 w-16 rounded-[1.6rem] bg-white/65 shadow-[0_10px_24px_rgba(255,255,255,0.4)] rotate-[-14deg]" />
      <div className="absolute left-12 top-10 h-20 w-16 rounded-[1.6rem] bg-white/40 shadow-[0_14px_28px_rgba(146,199,255,0.18)] rotate-[8deg]" />
      <div className="absolute bottom-7 right-8">
        <FolderIconBadge
          iconKey={iconKey}
          iconBgFrom={iconBgFrom}
          iconBgTo={iconBgTo}
          iconColor={iconColor}
          className="h-16 w-16 rounded-[1.4rem]"
          iconClassName="h-7 w-7"
        />
      </div>
      <div className="absolute bottom-5 left-6 h-10 w-10 rounded-full bg-white/85 shadow-[0_16px_26px_rgba(255,255,255,0.4)]" />
      <div className="absolute right-20 top-12 h-5 w-5 rounded-full bg-white/60" />
      <div className="absolute right-10 top-8 h-3 w-3 rounded-full bg-white/75" />
    </div>
  );
};

export default FolderCoverArt;
