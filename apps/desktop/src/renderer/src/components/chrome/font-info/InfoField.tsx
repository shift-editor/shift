import type { KeyboardEvent } from "react";
import { Input, cn } from "@shift/ui";

interface InfoFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  multiline?: boolean;
  readOnly?: boolean;
  type?: "text" | "number";
}

export const InfoField = ({
  label,
  value,
  onChange,
  onCommit,
  multiline = false,
  readOnly = false,
  type = "text",
}: InfoFieldProps) => {
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && event.metaKey) {
      event.currentTarget.blur();
    }
  };

  return (
    <>
      <label className="text-sm text-primary self-start pt-1.5">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyDown={handleTextareaKeyDown}
          rows={3}
          readOnly={readOnly}
          className={cn(
            "w-full resize-none rounded bg-white px-2 py-1 text-sm text-primary",
            "focus:outline-none focus:ring-1 focus:ring-accent",
            readOnly ? "text-muted" : null,
          )}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          readOnly={readOnly}
          className={cn("h-7 text-sm bg-white", readOnly ? "text-muted" : null)}
        />
      )}
    </>
  );
};
