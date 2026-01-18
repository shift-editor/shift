import HandIcon from '@/assets/toolbar/hand.svg';
import PenIcon from '@/assets/toolbar/pen.svg';
import SelectIcon from '@/assets/toolbar/select.svg';
import ShapeIcon from '@/assets/toolbar/shape.svg';
import { Editor } from '@/lib/editor/Editor';
import { ToolName, Tool } from '@/types/tool';

import { Hand } from './Hand';
import { Pen } from './pen';
import { Select } from './select';
import { Shape } from './Shape';

export interface ToolRegistryItem {
  tool: Tool;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
}

export const tools = new Map<ToolName, ToolRegistryItem>();

export const createToolRegistry = (editor: Editor) => {
  tools.set('select', {
    tool: new Select(editor),
    icon: SelectIcon,
    tooltip: 'Select Tool (V)',
  });
  tools.set('pen', { tool: new Pen(editor), icon: PenIcon, tooltip: 'Pen Tool (P)' });
  tools.set('hand', { tool: new Hand(editor), icon: HandIcon, tooltip: 'Hand Tool (H)' });
  tools.set('shape', { tool: new Shape(editor), icon: ShapeIcon, tooltip: 'Shape Tool (S)' });
};
