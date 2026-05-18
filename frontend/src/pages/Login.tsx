import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import { ShieldAlert, Users, KeyRound, Building } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', password);
      const response = await api.post('/auth/login', params);
      const { access_token, user } = response.data;
      login(access_token, user);
      if (user.is_admin || user.is_super_admin) {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '登录失败，请检查账号密码');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMockLogin = async (role: 'admin' | 'user') => {
    setIsLoading(true);
    setError('');
    try {
      const response = await api.get(`/auth/mock-login?role=${role}`);
      const { access_token, user } = response.data;
      login(access_token, user);
      navigate(role === 'admin' ? '/admin' : '/');
    } catch (err: any) {
      setError(err.response?.data?.detail || '登录失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDingTalkLogin = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/auth/dingtalk/login-url');
      if (response.data.url === '/auth/mock') {
        setError('当前为 Mock 模式，请使用模拟登录');
      } else {
        window.location.href = response.data.url;
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || '获取登录链接失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden border border-slate-100">
        <div className="px-8 pt-12 pb-8 text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-inner transform -rotate-6">
            <Building className="w-8 h-8 text-white transform rotate-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">企业资料门户</h2>
          <p className="text-slate-500 text-sm">统一的内部知识库与文件管理平台</p>
        </div>

        <div className="px-8 pb-12 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start">
              <ShieldAlert className="w-5 h-5 mr-3 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleDingTalkLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center px-6 py-3.5 bg-[#007FFF] text-white rounded-xl font-medium hover:bg-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow"
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.26 13.56L11 21.32a1.5 1.5 0 002.13-.12l8.35-9.67a1.5 1.5 0 00-.12-2.13L12.68 1.64a1.5 1.5 0 00-2.13.12L2.14 11.43a1.5 1.5 0 00.12 2.13z"/>
              </svg>
              钉钉一键登录
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-4 bg-white text-slate-400 font-medium tracking-wide uppercase">Mock 调试模式</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleMockLogin('user')}
                disabled={isLoading}
                className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-200 transition-all group"
              >
                <Users className="w-6 h-6 text-slate-400 group-hover:text-blue-500 mb-2" />
                <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700">普通用户</span>
              </button>

              <button
                onClick={() => setShowAdminForm(!showAdminForm)}
                disabled={isLoading}
                className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 transition-all group"
              >
                <KeyRound className="w-6 h-6 text-slate-400 group-hover:text-indigo-500 mb-2" />
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">账号密码登录</span>
              </button>
            </div>

            {showAdminForm && (
              <form onSubmit={handleAdminLogin} className="space-y-4 mt-6 p-5 bg-slate-50 border border-slate-200 rounded-xl animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">用户名</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="输入 admin"
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">密码</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入 Himice2024"
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors text-sm shadow-sm"
                >
                  {isLoading ? '登录中...' : '登录后台'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
