import { FC } from 'react';

import { tools } from '@/lib/tools/tools';
import AppState, { getEditor } from '@/store/store';
import { Svg } from '@/types/common';
import { ToolName } from '@/types/tool';

interface ToolbarIconProps {
  Icon: Svg;
  name: ToolName;
  activeTool: ToolName;
  onClick: () => void;
}
export const ToolbarIcon: FC<ToolbarIconProps> = ({ Icon, name, activeTool, onClick }) => {
  return (
    <div
      className={`rounded p-1 transition-colors duration-200 ${
        activeTool === name ? 'bg-[#4a4a54]' : 'hover:bg-[#4a4a54]'
      }`}
      onClick={onClick}
    >
      <Icon width={18} height={18} />
    </div>
  );
};

export const ToolsPane: FC = () => {
  const activeTool = AppState((state) => state.activeTool);
  const setActiveTool = AppState((state) => state.setActiveTool);
  const editor = getEditor();

  return (
    <section className="flex items-center justify-center gap-2">
      {Array.from(tools.entries()).map(([name, { icon }]) => (
        <ToolbarIcon
          key={name}
          Icon={icon}
          name={name}
          activeTool={activeTool}
          onClick={() => {
            setActiveTool(name);
            editor.activeTool().setReady();
          }}
        />
      ))}
    </section>
  );
};
