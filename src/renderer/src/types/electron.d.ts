import { fontEngine } from "../../../preload/preload";

export type FontEngine = typeof fontEngine;

declare global {
  interface Window {
    shiftFont: FontService;
  }
}
