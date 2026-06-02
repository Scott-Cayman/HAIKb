import { Star } from 'lucide-react';

type FavoriteButtonProps = {
  active: boolean;
  onClick: () => void;
  title: string;
  className?: string;
};

const FavoriteButton = ({ active, onClick, title, className = '' }: FavoriteButtonProps) => {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className={`inline-flex items-center justify-center rounded-lg border transition-colors ${
        active
          ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'
          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-amber-500'
      } ${className}`}
    >
      <Star className={`h-4 w-4 ${active ? 'fill-current' : ''}`} />
    </button>
  );
};

export default FavoriteButton;
