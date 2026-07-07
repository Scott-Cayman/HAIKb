const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const envBackendBaseUrl = (import.meta.env.VITE_BACKEND_BASE_URL as string | undefined)?.trim() || '';
const envApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';

// 开发和生产默认都优先走同源路径。
// 开发模式通过 Vite proxy 转发到本机后端，生产模式通过 Nginx 转发到本机后端。
const defaultBackendBaseUrl = '';

export const BACKEND_BASE_URL = trimTrailingSlash(envBackendBaseUrl || defaultBackendBaseUrl);
export const API_BASE_URL = envApiBaseUrl
  ? trimTrailingSlash(envApiBaseUrl)
  : BACKEND_BASE_URL
    ? `${BACKEND_BASE_URL}/api`
    : '/api';
