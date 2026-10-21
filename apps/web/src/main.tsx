import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ensureSession } from './api/client.ts';
import { App } from './App.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 500 },
    mutations: { retry: 0 },
  },
});

// CSRF 토큰을 미리 받아 둔다 (메모리 보관). 실패해도 첫 변경 요청에서 다시 시도한다.
void ensureSession().catch(() => undefined);

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
