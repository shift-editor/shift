import './App.css';
import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

import AppState from '@/store/store';

import { routes } from './routes';

export const App = () => {
  useEffect(() => {
    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont((filePath) => {
      const editor = AppState.getState().editor;
      editor.loadFont(filePath);
      editor.updateMetricsFromFont();
      AppState.getState().setFileName(filePath.split('/').pop() ?? '');
    });

    return () => {
      unsubscribeOpen?.();
    };
  }, []);

  return (
    <HashRouter>
      <Routes>
        {routes.map((route) => (
          <Route key={route.id} path={route.path} element={<route.component />} />
        ))}
      </Routes>
    </HashRouter>
  );
};

export default App;
