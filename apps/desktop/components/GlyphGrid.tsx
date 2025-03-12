import { FC } from 'react';

import { useNavigate } from 'react-router-dom';

interface GlyphGridProps {
  onSelectGlyph?: (char: string, code: number) => void;
  className?: string;
}

export const GlyphGrid: FC<GlyphGridProps> = ({ onSelectGlyph, className = '' }) => {
  const navigate = useNavigate();

  // Generate uppercase letters (A-Z)
  const uppercaseLetters = Array.from({ length: 26 }, (_, i) => {
    const char = String.fromCharCode(65 + i);
    return { char, code: 65 + i };
  });

  // Generate lowercase letters (a-z)
  const lowercaseLetters = Array.from({ length: 26 }, (_, i) => {
    const char = String.fromCharCode(97 + i);
    return { char, code: 97 + i };
  });

  // Combine both sets
  const allLetters = [...uppercaseLetters, ...lowercaseLetters];

  const handleGlyphClick = (char: string, code: number) => {
    if (onSelectGlyph) {
      onSelectGlyph(char, code);
    } else {
      // Default behavior: navigate to the editor with the character code
      navigate(`/editor/${code}`);
    }
  };

  return (
    <div
      className={`grid grid-cols-6 gap-2 p-4 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-13 ${className}`}
    >
      {allLetters.map(({ char, code }) => (
        <button
          key={code}
          className="border-secondary-200 flex aspect-square items-center justify-center rounded-md bg-[#ededed] text-[5rem] font-medium text-black/30 transition-colors duration-200 hover:bg-[#868686]"
          onClick={() => handleGlyphClick(char, code)}
        >
          {char}
        </button>
      ))}
    </div>
  );
};
