import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { useLoadingStore } from '../stores/loadingStore';

const api = axios.create({
  baseURL: 'http://113.59.125.17:5181/api',
  timeout: 60000,
});

// 为长时间操作单独设置超时
export const LONG_TIMEOUT = 5 * 60 * 1000; // 5分钟

let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
let activeRequests = 0;

interface CacheEntry {
  data: AxiosResponse;
  timestamp: number;
}

const pendingRequests = new Map<string, Promise<any>>();
const responseCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL = 30000; // 30秒缓存

const getRequestKey = (config: AxiosRequestConfig): string => {
  const { method, url, params, data } = config;
  return `${method}-${url}-${JSON.stringify(params || {})}-${JSON.stringify(data || {})}`;
};

const showLoading = () => {
  if (loadingTimeout) {
    clearTimeout(loadingTimeout);
  }
  loadingTimeout = setTimeout(() => {
    useLoadingStore.getState().showLoading();
  }, 2000);
};

const hideLoading = () => {
  if (loadingTimeout) {
    clearTimeout(loadingTimeout);
    loadingTimeout = null;
  }
  useLoadingStore.getState().hideLoading();
};

const shouldCache = (config: AxiosRequestConfig): boolean => {
  const { method, url } = config;
  if (method !== 'GET') return false;
  if (url?.includes('/agent/chat')) return false;
  if (url?.includes('/auth/me')) return true;
  if (url?.includes('/folders')) return true;
  if (url?.includes('/files/recent')) return true;
  return false;
};

api.interceptors.request.use(
  (config) => {
    const isAgentChat = config.url?.includes('/agent/chat');
    if (!isAgentChat) {
      activeRequests++;
      showLoading();
    }
    
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    const isAgentChat = error.config?.url?.includes('/agent/chat');
    if (!isAgentChat) {
      activeRequests--;
      if (activeRequests === 0) {
        hideLoading();
      }
    }
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    const isAgentChat = response.config?.url?.includes('/agent/chat');
    if (!isAgentChat) {
      activeRequests--;
      if (activeRequests === 0) {
        hideLoading();
      }
    }
    return response;
  },
  (error) => {
    const isAgentChat = error.config?.url?.includes('/agent/chat');
    if (!isAgentChat) {
      activeRequests--;
      if (activeRequests === 0) {
        hideLoading();
      }
    }
    
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

const originalRequest = api.request;
api.request = (config: AxiosRequestConfig) => {
  const requestKey = getRequestKey(config);
  
  if (pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey) as Promise<any>;
  }
  
  if (shouldCache(config)) {
    const cached = responseCache.get(requestKey);
    if (cached && Date.now() - cached.timestamp < DEFAULT_CACHE_TTL) {
      return Promise.resolve(cached.data as AxiosResponse);
    }
  }
  
  const requestPromise = originalRequest.call(api, config);
  pendingRequests.set(requestKey, requestPromise);
  
  requestPromise
    .then((response) => {
      if (shouldCache(config)) {
        responseCache.set(requestKey, {
          data: response as AxiosResponse,
          timestamp: Date.now(),
        });
      }
    })
    .finally(() => {
      pendingRequests.delete(requestKey);
    });
  
  return requestPromise;
};

export const clearCache = () => {
  responseCache.clear();
};

export default api;
