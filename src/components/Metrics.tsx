import { useEffect, useRef } from "react";

export const Metrics = () => {
  const xRef = useRef<HTMLDivElement>(null);
  const yRef = useRef<HTMLDivElement>(null);

  useEffect(() => {}, []);

  return (
    <>
      <div className="absolute bottom-2 left-5 grid max-w-fit grid-cols-2 border border-black p-2 text-sm">
        <div>x</div>
        <div ref={xRef} />
        <div>y</div>
        <div ref={yRef} />
      </div>
    </>
  );
};
