import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hmrHost = env.VITE_HMR_HOST?.trim()
  const hmrClientPort = env.VITE_HMR_CLIENT_PORT ? Number(env.VITE_HMR_CLIENT_PORT) : undefined
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET?.trim() || 'http://127.0.0.1:9090'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
        },
        '/health': {
          target: devProxyTarget,
          changeOrigin: true,
        },
      },
      ...(hmrHost
        ? {
            hmr: {
              host: hmrHost,
              clientPort: hmrClientPort || 5173,
              protocol: 'ws',
            },
          }
        : {}),
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
    },
    build: {
      target: 'esnext',
    },
  }
})
