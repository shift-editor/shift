import { useNavigate } from 'react-router-dom';

import { GlyphGrid } from '@/components/GlyphGrid';

export const Home = () => {
  const navigate = useNavigate();

  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <GlyphGrid />
      <button
        onClick={() => {
          navigate('/editor/1');
        }}
      >
        Editor
      </button>
    </main>
  );
};
