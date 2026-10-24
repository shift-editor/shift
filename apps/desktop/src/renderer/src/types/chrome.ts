export interface ToolbarProps {
  /** Whether each sidebar is open, so its toggle shows its side filled. */
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}
