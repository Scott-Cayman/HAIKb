import { Star } from 'lucide-react';

const Favorites = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
          <Star className="w-5 h-5 text-amber-600 fill-amber-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">我的收藏</h1>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 mb-2">暂无收藏</h3>
          <p className="text-slate-500 text-sm">收藏重要的文件和文件夹后，会显示在这里</p>
        </div>
      </div>
    </div>
  );
};

export default Favorites;
