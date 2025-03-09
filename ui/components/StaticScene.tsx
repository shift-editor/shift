import { useContext } from 'react';

import { CanvasContext } from '@/context/CanvasContext';

export const StaticScene = () => {
  const { staticCanvasRef } = useContext(CanvasContext);

  return (
    <canvas
      id="static-canvas"
      ref={staticCanvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
};
