import React, { useState, useEffect } from 'react';
import { checkBackendHealth } from '../services/api';

const BackendReadyCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkBackend = async () => {
      const health = await checkBackendHealth();
      if (health) {
        setIsChecking(false);
        return;
      }

      let attempts = 0;
      const maxAttempts = 30;

      const interval = setInterval(async () => {
        attempts++;
        const h = await checkBackendHealth();
        if (h) {
          setIsChecking(false);
          clearInterval(interval);
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setIsChecking(false);
        }
      }, 2000);

      return () => clearInterval(interval);
    };

    checkBackend();
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">等待后端服务就绪...</h2>
          <p className="text-gray-500">系统正在启动，请稍候</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default BackendReadyCheck;
