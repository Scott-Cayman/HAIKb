import { useLoadingStore } from '../stores/loadingStore';
import { Loader2 } from 'lucide-react';

export const GlobalLoading = () => {
  const isLoading = useLoadingStore((state) => state.isLoading);

  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-200">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
        <div className="text-lg font-medium text-slate-800">加载中</div>
        <div className="text-sm text-slate-500">请稍候...</div>
      </div>
    </div>
  );
};
