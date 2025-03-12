import * as React from 'react';

import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
