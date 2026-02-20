declare global {
  interface Window {
    reactScan?: ((options?: ReactScanOptions) => void) & {
      setOptions?: (options: ReactScanOptions) => void;
      getOptions?: () => ReactScanOptions;
    };
  }
}

interface ReactScanOptions {
  enabled?: boolean;
  showToolbar?: boolean;
}

const REACT_SCAN_SCRIPT_ID = "react-scan-script";
const REACT_SCAN_URL = "https://unpkg.com/react-scan/dist/auto.global.js";

let isEnabled = false;
let scriptLoaded = false;

function waitForReactScan(timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.reactScan) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.reactScan) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error("react-scan failed to load"));
      }
    }, 50);
  });
}

function applyOptions(options: ReactScanOptions): void {
  if (!window.reactScan) return;

  // Try setOptions if available (attached method)
  if (typeof window.reactScan.setOptions === "function") {
    window.reactScan.setOptions(options);
    return;
  }

  // Try calling reactScan as a function (scan function)
  if (typeof window.reactScan === "function") {
    window.reactScan(options);
    return;
  }
}

export async function enableReactScan(): Promise<void> {
  if (isEnabled) return;

  if (!scriptLoaded) {
    const existing = document.getElementById(REACT_SCAN_SCRIPT_ID);
    if (!existing) {
      const script = document.createElement("script");
      script.id = REACT_SCAN_SCRIPT_ID;
      script.src = REACT_SCAN_URL;
      document.head.appendChild(script);
    }

    try {
      await waitForReactScan();
      scriptLoaded = true;
    } catch {
      return;
    }
  }

  applyOptions({ enabled: true, showToolbar: true });
  isEnabled = true;
}

export function disableReactScan(): void {
  if (!isEnabled) {
    return;
  }

  applyOptions({ enabled: false, showToolbar: false });
  isEnabled = false;
}
