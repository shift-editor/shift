import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";
import { Button, Input } from "@shift/ui";

export const GlyphGrid = () => {
  const navigate = useNavigate();
  const glyphStr = (unicode: string) => String.fromCharCode(parseInt(unicode, 16));

  const initialValues = Object.fromEntries(
    Object.values(ADOBE_LATIN_1).map((glyph) => [glyph.unicode, glyphStr(glyph.unicode)])
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>(initialValues);

  const handleInputChange = (unicode: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [unicode]: value }));
  };

  return (
    <section className="h-full w-full p-5">
      <div className="grid grid-cols-6 gap-2 p-4 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-13">
        {Object.values(ADOBE_LATIN_1).map((glyph) => {
          return (
            <div>
              <div key={glyph.unicode} className="flex flex-col items-center justify-center gap-4">
                <Button
                  className="w-full h-full text-5xl font-light text-muted p-4"
                  onClick={() => navigate(`/editor/${glyph.unicode}`)}
                  variant="ghost"
                >
                  {glyphStr(glyph.unicode)}
                </Button>
                <Input
                  className="w-full text-center bg-none"
                  value={inputValues[glyph.unicode]}
                  onChange={(e) => handleInputChange(glyph.unicode, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
