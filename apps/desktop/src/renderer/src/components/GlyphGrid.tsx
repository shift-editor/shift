import { useNavigate } from "react-router-dom";

import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";

export const GlyphGrid = () => {
  const navigate = useNavigate();

  return (
    <section className="h-full w-full p-5">
      <div className="font-ui text-ui p-2 font-bold text-primary">
        <h1>Adobe Latin 1</h1>
      </div>
      <div className="grid grid-cols-6 gap-2 p-4 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-13">
        {Object.values(ADOBE_LATIN_1).map((glyph) => {
          return (
            <div key={glyph.char_name}>
              <button
                className="flex aspect-square w-full items-center justify-center rounded-md border bg-surface text-center text-4xl text-secondary transition-colors duration-200 hover:bg-surface-hover"
                onClick={() => navigate(`/editor/${glyph.unicode}`)}
              >
                {String.fromCharCode(parseInt(glyph.unicode, 16))}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};
