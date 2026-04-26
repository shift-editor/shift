import { Button } from "@shift/ui";
import { useSources } from "@/hooks/useSources";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useApplyVariation } from "@/hooks/useApplyVariation";

export const Sources = () => {
  const sources = useSources();
  const activeSourceId = useActiveSourceId();
  const apply = useApplyVariation();

  if (sources.length === 0) return null;

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((s) => (
        <Button
          className="text-ui w-full items-center justify-start px-2 h-6 data-[active=true]:bg-hover"
          variant="ghost"
          key={s.id}
          type="button"
          isActive={s.id === activeSourceId}
          onClick={() => apply({ ...s.location })}
        >
          {s.name}
        </Button>
      ))}
    </div>
  );
};
