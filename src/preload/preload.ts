// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge } = require("electron");
const { FontEngine } = require("shift-font");

const fontEngineInstance = new FontEngine();

export const fontEngine = {
  loadFont: (path: string) => {
    return fontEngineInstance.loadFont(path);
  },
  getFontFamily: () => {
    return fontEngineInstance.getFontFamily();
  },
  getFontStyle: () => {
    return fontEngineInstance.getFontStyle();
  },
  getMetrics: () => {
    return fontEngineInstance.getMetrics();
  },
};

contextBridge.exposeInMainWorld("shiftFont", fontEngine);
