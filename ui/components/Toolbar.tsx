import { FC } from 'react';

import { useNavigate } from 'react-router-dom';

import GridSvg from '@/assets/toolbar/grid.svg';
import { tools } from '@/lib/tools/tools';
import AppState, { getEditor } from '@/store/store';
import { ToolName } from '@/types/tool';

interface ToolbarIconProps {
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
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
      <Icon />
    </div>
  );
};

export const Toolbar = () => {
  const setActiveTool = AppState((state) => state.setActiveTool);
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  const navigate = useNavigate();

  return (
    <main className="flex h-[7.5vh] w-screen items-center justify-center bg-[#2d2d2d]">
      <div className="ml-22 flex-1">
        <div className="h-fit w-fit rounded-sm hover:bg-[#4a4a54]" onClick={() => navigate('/')}>
          <GridSvg />
        </div>
      </div>
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
      <div className="flex-1" />
    </main>
  );
};
