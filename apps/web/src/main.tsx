import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App';
import { MeProvider } from './state/me';
import { Toaster } from './components/ui';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <MeProvider>
          <App />
          <Toaster />
        </MeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
