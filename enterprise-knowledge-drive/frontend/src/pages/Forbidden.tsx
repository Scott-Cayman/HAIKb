import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

const Forbidden = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center">
        <ShieldAlert className="w-20 h-20 text-red-500 mx-auto mb-6 opacity-80" />
        <h1 className="text-3xl font-bold text-slate-900 mb-4">访问受限</h1>
        <p className="text-slate-500 mb-8 max-w-md mx-auto">您没有权限访问此页面或当前操作被拒绝。如果您认为是系统错误，请联系系统管理员。</p>
        <Link 
          to="/" 
          className="inline-flex items-center px-6 py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
};

export default Forbidden;
