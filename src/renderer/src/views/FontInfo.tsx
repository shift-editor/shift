import { Toolbar } from "@/components/Toolbar";

export const FontInfo = () => {
  return (
    <>
      <Toolbar />
      <main className="text-light flex h-screen w-screen flex-col items-center justify-center text-white">
        <h1>Font Info</h1>
        <div>
          <p>Units per em: 1000</p>
          <p>Ascender: 100</p>
          <p>Descender: 100</p>
          <p>Cap height: 100</p>
        </div>
      </main>
    </>
  );
};
