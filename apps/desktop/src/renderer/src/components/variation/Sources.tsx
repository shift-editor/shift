import { Button } from "@shift/ui";
import { useSources } from "@/hooks/useSources";
import { useEditSourceId } from "@/hooks/useEditSourceId";
import { getEditor } from "@/store/appStore";

export const Sources = () => {
  const sources = useSources();
  const editSourceId = useEditSourceId();
  const editor = getEditor();

  if (sources.length === 0) return null;

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((s) => (
        <Button
          className="text-ui w-full items-center justify-start px-2 h-6"
          variant="ghost"
          key={s.id}
          isActive={s.id === editSourceId}
          onClick={() => editor.selectSource(s.id)}
        >
          {s.name}
        </Button>
      ))}
    </div>
  );
};
