// debounce
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  };
}

// throttle

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): T {
  let lastCallTime: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastContext: any;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();

    // If first call or enough time has passed, invoke the function
    if (lastCallTime == null || now - lastCallTime >= wait) {
      func.apply(this, args);
      lastCallTime = now;
    } else {
      // Otherwise, save the arguments/context for the next available slot
      lastArgs = args;
      lastContext = this;

      // If no timeout is active, set one that will invoke the function later
      if (!timeoutId) {
        const remaining = wait - (now - lastCallTime);
        timeoutId = setTimeout(() => {
          func.apply(lastContext, lastArgs as Parameters<T>);
          lastArgs = null;
          lastContext = null;
          lastCallTime = Date.now();
          timeoutId = null;
        }, remaining);
      }
    }
  } as T;
}

export function throttleRAF<T extends (...args: any[]) => void>(
  callback: T
): T {
  let queued = false;
  let lastArgs: Parameters<T> | null = null;
  let lastContext: any = null;

  return function (this: any, ...args: Parameters<T>) {
    lastArgs = args;
    lastContext = this;

    // If there's already a requestAnimationFrame queued, just update the args
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        callback.apply(lastContext, lastArgs as Parameters<T>);
        queued = false;
        lastArgs = null;
        lastContext = null;
      });
    }
  } as T;
}
