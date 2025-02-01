import { useEffect, useRef } from "react";

import AppState from "../store/store";

export const Metrics = () => {
  const xRef = useRef<HTMLDivElement>(null);
  const yRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateMousePosition = () => {
      const { x, y } = AppState.getState().canvasContext.mousePosition;
      if (xRef.current) xRef.current.textContent = Math.round(x).toString();
      if (yRef.current) yRef.current.textContent = Math.round(y).toString();
    };

    window.addEventListener("mousemove", updateMousePosition);

    return () => {
      window.removeEventListener("mousemove", updateMousePosition);
    };
  }, []);

  return (
    <div className="absolute bottom-2 left-5 grid max-w-fit grid-cols-2 border border-black p-2 text-sm">
      <div>x</div>
      <div ref={xRef}></div>
      <div>y</div>
      <div ref={yRef}></div>
    </div>
  );
};
