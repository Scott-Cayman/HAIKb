import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

type CallbackResponse = {
  access_token: string;
  token_type: 'bearer';
  user: any;
};

const DingTalkCallback = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const isProcessing = useRef(false);

  const payload = useMemo(() => {
    const code = searchParams.get('authCode') || searchParams.get('code') || '';
    const state = searchParams.get('state') || '';
    return { code, state };
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isProcessing.current) {
        return;
      }
      
      if (!payload.code) {
        setError('缺少授权码');
        return;
      }
      if (!payload.state) {
        setError('缺少 state');
        return;
      }

      isProcessing.current = true;
      
      setSearchParams({}, { replace: true });

      try {
        const response = await api.post<CallbackResponse>('/auth/dingtalk/callback', payload);
        const { access_token, user } = response.data;
        login(access_token, user);
        navigate('/', { replace: true });
      } catch (err: any) {
        const message = err?.response?.data?.detail || err?.message || '钉钉登录失败';
        if (!cancelled) {
          setError(message);
          setTimeout(() => navigate('/login', { replace: true }), 1200);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [login, navigate, payload.code, payload.state, setSearchParams]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="text-slate-900 font-semibold text-lg">钉钉登录</div>
        <div className="mt-2 text-slate-500 text-sm">
          {error ? '登录失败' : '正在完成授权...'}
        </div>
        {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</div>}
      </div>
    </div>
  );
};

export default DingTalkCallback;
