import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '../../src/styles/globals.css';
import { localizeDocument } from '@/lib/i18n';

localizeDocument('extensionName');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
