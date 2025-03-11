import './App.css';
import { HashRouter, Route, Routes } from 'react-router-dom';

import { routes } from './routes';

export const App = () => {
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
