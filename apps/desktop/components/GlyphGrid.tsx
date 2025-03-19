import { useNavigate } from 'react-router-dom';

import { ADOBE_LATIN_1 } from '@/data/charsets';

export const GlyphGrid = () => {
  const navigate = useNavigate();

  return (
    <>
      <h1>Adobe Latin 1</h1>
      <div className="grid grid-cols-6 gap-2 p-4 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-13">
        {Object.values(ADOBE_LATIN_1).map((glyph) => {
          return (
            <div key={glyph.char_name}>
              <button
                className="border-secondary-200 flex aspect-square w-full items-center justify-center rounded-md bg-[#ededed] text-center text-[4rem] text-black/30 transition-colors duration-200 hover:bg-[#868686]"
                onClick={() => navigate(`/editor/${glyph.unicode}`)}
              >
                {String.fromCharCode(parseInt(glyph.unicode, 16))}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
};
