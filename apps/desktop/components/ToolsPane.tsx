import { FC, useEffect } from 'react';

import { FontLoadedEvent } from '@shift/shared';
import { listen } from '@tauri-apps/api/event';

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

  const fileName = AppState((state) => state.fileName);

  useEffect(() => {
    const unsubscribe = listen<FontLoadedEvent>('font-loaded', (event) => {
      AppState.setState({ fileName: event.payload.fileName });
    });

    return () => {
      unsubscribe.then((fn) => fn());
    };
  }, []);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <h1 className="text-xs text-gray-300">{fileName}</h1>
      <div className="flex items-center gap-2">
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
      </div>
    </section>
  );
};
