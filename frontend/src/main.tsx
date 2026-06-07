import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { SDKProvider } from '@tma.js/sdk-react';

import App from './App';
import './index.css';

const manifestUrl =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? `${window.location.origin}/tonconnect-manifest.json`;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Bridges the app to the Telegram WebApp environment (theme, viewport, haptics, ...) */}
    <SDKProvider acceptCustomStyles debug={import.meta.env.DEV}>
      {/* Wallet connection + transaction signing via TON Connect */}
      <TonConnectUIProvider manifestUrl={manifestUrl}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TonConnectUIProvider>
    </SDKProvider>
  </React.StrictMode>,
);
