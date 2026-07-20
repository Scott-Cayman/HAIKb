import { ArrowRight, Loader2, Search, Sparkles } from 'lucide-react';

type SearchComposerProps = {
  mode: 'hero' | 'inline';
  value: string;
  loading: boolean;
  searchType?: 'ai' | 'keyword';
  error?: string | null;
  suggestions?: string[];
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onSearchTypeChange?: (value: 'ai' | 'keyword') => void;
  onSuggestionClick?: (value: string) => void;
  onKeywordSearchClick?: (value: string) => void;
};

const SearchComposer = ({
  mode,
  value,
  loading,
  searchType = 'ai',
  error,
  suggestions = [],
  placeholder,
  onChange,
  onSubmit,
  onSearchTypeChange,
  onSuggestionClick,
  onKeywordSearchClick,
}: SearchComposerProps) => {
  const isHero = mode === 'hero';
  const submitCurrentValue = () => {
    if (!value.trim() || loading) return;

    if (searchType === 'keyword') {
      onKeywordSearchClick?.(value);
      return;
    }

    onSubmit(value);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement> = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submitCurrentValue();
  };

  return (
    <div className="relative min-w-0 w-full">
      <div
        className="relative overflow-hidden rounded-[22px] border border-slate-200 bg-white transition-all duration-700 md:rounded-[32px]"
      >
        <div
          className={`relative flex min-w-0 gap-3 transition-all duration-700 ${
            isHero
              ? 'flex-col px-3 py-3 lg:flex-row lg:items-center lg:px-7 lg:py-5'
              : 'flex-col px-3 py-3 lg:flex-row lg:items-center lg:px-5 lg:py-4'
          }`}
        >
          <Search className="absolute left-4 top-[22px] h-5 w-5 shrink-0 text-slate-400 transition-all duration-700 lg:static lg:mt-0.5" />

          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || (isHero ? '请输入问题、关键词或文件主题，例如：新人入职流程' : '继续追问，补充筛选条件或指定想看的文件')}
            className={`min-w-0 flex-1 bg-transparent pl-8 text-[15px] text-slate-700 outline-none placeholder:text-slate-400 transition-all duration-700 lg:pl-0 ${
              isHero ? 'h-10 md:h-11 md:text-base' : 'h-9 md:h-10 md:text-[15px]'
            }`}
          />

          <div className="flex min-w-0 w-full shrink-0 items-center justify-between gap-2 lg:w-auto lg:self-auto">
            {mode === 'hero' || mode === 'inline' ? (
              <>
                <div className="inline-flex min-w-0 flex-1 items-center rounded-full border border-slate-200 bg-white p-1 md:flex-none">
                  <button
                    type="button"
                    onClick={() => onSearchTypeChange?.('ai')}
                    className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full transition-all duration-300 ${
                      searchType === 'ai'
                        ? 'bg-gradient-to-r from-[#76ebdc] to-[#6dc9ff] font-semibold text-white'
                        : 'text-slate-500 hover:bg-[#f4f8fb] hover:text-slate-700'
                    } ${isHero ? 'flex-1 px-2.5 py-2 text-xs sm:px-4 sm:text-sm md:flex-none' : 'flex-1 px-2.5 py-1.5 text-xs sm:px-3 sm:text-[13px] md:flex-none'}`}
                  >
                    <Sparkles className={isHero ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
                    AI 检索
                  </button>
                  <button
                    type="button"
                    onClick={() => onSearchTypeChange?.('keyword')}
                    className={`inline-flex min-w-0 items-center justify-center whitespace-nowrap rounded-full transition-all duration-300 ${
                      searchType === 'keyword'
                        ? 'bg-gradient-to-r from-[#76ebdc] to-[#6dc9ff] font-semibold text-white'
                        : 'text-slate-500 hover:bg-[#f4f8fb] hover:text-slate-700'
                    } ${isHero ? 'flex-1 px-2.5 py-2 text-xs sm:px-4 sm:text-sm md:flex-none' : 'flex-1 px-2.5 py-1.5 text-xs sm:px-3 sm:text-[13px] md:flex-none'}`}
                  >
                    关键词检索
                  </button>
                </div>

                <button
                  type="button"
                  onClick={submitCurrentValue}
                  disabled={loading || !value.trim()}
                  className={`inline-flex items-center justify-center rounded-full transition-all duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 ${
                    isHero
                      ? 'h-10 w-10 bg-gradient-to-r from-[#74eadc] to-[#6fcbff] text-white'
                      : 'h-9 w-9 bg-gradient-to-r from-[#74eadc] to-[#6fcbff] text-white'
                  }`}
                  aria-label="执行搜索"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isHero ? (
                    <ArrowRight className="h-4 w-4" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-4 flex min-w-0 flex-wrap items-center justify-center gap-2 text-sm transition-all duration-700 md:mt-5 md:gap-3">
          <span className="shrink-0 text-slate-400">猜你想问：</span>
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onSuggestionClick?.(item)}
              className="min-w-0 max-w-full rounded-full border border-white/70 bg-white/76 px-3.5 py-1.5 text-left leading-5 text-slate-500 shadow-[0_10px_20px_rgba(191,203,226,0.12)] transition-colors hover:bg-[#eefcf8] hover:text-[#27ad9f]"
            >
              <span className="block max-w-full break-words">{item}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-center text-sm text-red-500">{error}</p> : null}
    </div>
  );
};

export default SearchComposer;
