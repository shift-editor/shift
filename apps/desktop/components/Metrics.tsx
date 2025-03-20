import { useEffect, useRef } from 'react';

import { getEditor } from '@/store/store';

export const Metrics = () => {
  const xRef = useRef<HTMLDivElement>(null);
  const yRef = useRef<HTMLDivElement>(null);
  const editor = getEditor();

  useEffect(() => {
    const updateMouseMetrics = () => {
      if (!xRef.current || !yRef.current) return;

      const { x, y } = editor.getUpmMousePosition();

      xRef.current.textContent = Math.round(x).toString();
      yRef.current.textContent = Math.round(y).toString();
    };

    window.addEventListener('mousemove', updateMouseMetrics);

    return () => {
      window.removeEventListener('mousemove', updateMouseMetrics);
    };
  }, []);

  return (
    <>
      <div className="absolute bottom-2 left-[50%] grid max-w-fit grid-cols-2 rounded-sm border border-gray-200 bg-gray-200 p-2 text-sm">
        <div>x</div>
        <div className="text-right" ref={xRef} />
        <div>y</div>
        <div className="text-right" ref={yRef} />
      </div>
    </>
  );
};
