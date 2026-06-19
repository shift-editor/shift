import { useSources } from "@/hooks/useSources";
import { useEditSourceId } from "@/hooks/useEditSourceId";
import { getEditor } from "@/store/appStore";
import { SidebarActionRow } from "@/components/sidebar";

export const Sources = () => {
  const sources = useSources();
  const editSourceId = useEditSourceId();
  const editor = getEditor();

  if (sources.length === 0) return null;

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((s) => (
        <SidebarActionRow
          key={s.id}
          isActive={s.id === editSourceId}
          onClick={() => editor.selectSource(s.id)}
          contentClassName="h-6 text-ui"
        >
          {s.name}
        </SidebarActionRow>
      ))}
    </div>
  );
};
