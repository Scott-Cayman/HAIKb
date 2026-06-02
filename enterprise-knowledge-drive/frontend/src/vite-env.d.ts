/// <reference types="vite/client" />

declare module '*.css';

import 'react';

declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}
