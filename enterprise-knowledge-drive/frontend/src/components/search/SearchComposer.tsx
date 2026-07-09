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
    <div className={isHero ? 'relative w-full md:-ml-[30px] md:w-[calc(100%+30px)]' : 'relative w-full'}>
      <div
        className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-white transition-all duration-700"
      >
        <div
          className={`relative flex gap-3 transition-all duration-700 ${
            isHero
              ? 'flex-col px-5 py-4 md:flex-row md:items-center md:px-7 md:py-5'
              : 'flex-col px-4 py-3 md:flex-row md:items-center md:px-5 md:py-4'
          }`}
        >
          <Search className="h-5 w-5 shrink-0 text-slate-400 transition-all duration-700 md:mt-0.5" />

          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || (isHero ? '请输入问题、关键词或文件主题，例如：新人入职流程' : '继续追问，补充筛选条件或指定想看的文件')}
            className={`flex-1 bg-transparent text-[15px] text-slate-700 outline-none placeholder:text-slate-400 transition-all duration-700 ${
              isHero ? 'h-10 md:h-11 md:text-base' : 'h-9 md:h-10 md:text-[15px]'
            }`}
          />

          <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
            {mode === 'hero' || mode === 'inline' ? (
              <>
                <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => onSearchTypeChange?.('ai')}
                    className={`inline-flex items-center gap-2 rounded-full transition-all duration-300 ${
                      searchType === 'ai'
                        ? 'bg-gradient-to-r from-[#76ebdc] to-[#6dc9ff] font-semibold text-white'
                        : 'text-slate-500 hover:bg-[#f4f8fb] hover:text-slate-700'
                    } ${isHero ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-[13px]'}`}
                  >
                    <Sparkles className={isHero ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
                    AI 检索
                  </button>
                  <button
                    type="button"
                    onClick={() => onSearchTypeChange?.('keyword')}
                    className={`inline-flex items-center rounded-full transition-all duration-300 ${
                      searchType === 'keyword'
                        ? 'bg-gradient-to-r from-[#76ebdc] to-[#6dc9ff] font-semibold text-white'
                        : 'text-slate-500 hover:bg-[#f4f8fb] hover:text-slate-700'
                    } ${isHero ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-[13px]'}`}
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
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm transition-all duration-700">
          <span className="text-slate-400">猜你想问：</span>
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onSuggestionClick?.(item)}
              className="rounded-full border border-white/70 bg-white/76 px-3.5 py-1.5 text-slate-500 shadow-[0_10px_20px_rgba(191,203,226,0.12)] transition-colors hover:bg-[#eefcf8] hover:text-[#27ad9f]"
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-center text-sm text-red-500">{error}</p> : null}
    </div>
  );
};

export default SearchComposer;
