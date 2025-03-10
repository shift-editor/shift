import './index.css';
import './App.css';
import { HashRouter, Route, Routes } from 'react-router-dom';

import { Editor } from './windows/Editor';
import { Home } from './windows/Home';

export const AppWrapper = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="editor/:glyphId" element={<Editor />} />
      </Routes>
    </HashRouter>
  );
};

export default AppWrapper;
