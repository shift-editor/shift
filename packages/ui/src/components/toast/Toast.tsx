import * as React from "react";
import { Toast as BaseToast } from "@base-ui-components/react/toast";
import { cn } from "../../lib/utils";

interface ToastProviderProps {
  children: React.ReactNode;
  timeout?: number;
}

function ToastProvider({ children, timeout = 2000 }: ToastProviderProps) {
  return <BaseToast.Provider timeout={timeout}>{children}</BaseToast.Provider>;
}

interface ToastViewportProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function ToastViewport({ children, className, style }: ToastViewportProps) {
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport
        className={cn("fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2", className)}
        style={style}
      >
        {children}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}

interface ToastRootProps {
  toast: BaseToast.Root.ToastObject;
  children: React.ReactNode;
  className?: string;
}

function ToastRoot({ toast, children, className }: ToastRootProps) {
  return (
    <BaseToast.Root
      toast={toast}
      style={{ boxShadow: "0 2px 5px -1px rgba(50,50,93,.25),0 1px 3px -1px rgba(0,0,0,.3)" }}
      className={cn(
        "bg-panel rounded-sm p-2 text-sm text-black",
        "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        "transition-opacity duration-200",
        className,
      )}
    >
      {children}
    </BaseToast.Root>
  );
}

interface ToastTitleProps {
  children: React.ReactNode;
  className?: string;
}

function ToastTitle({ children, className }: ToastTitleProps) {
  return <BaseToast.Title className={cn("font-medium", className)}>{children}</BaseToast.Title>;
}

interface ToastDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

function ToastDescription({ children, className }: ToastDescriptionProps) {
  return (
    <BaseToast.Description className={cn("text-neutral-300", className)}>
      {children}
    </BaseToast.Description>
  );
}

function ToastClose({ className }: { className?: string }) {
  return (
    <BaseToast.Close
      className={cn("absolute top-2 right-2 text-neutral-400 hover:text-white", className)}
    >
      ×
    </BaseToast.Close>
  );
}

const useToastManager = BaseToast.useToastManager;

export {
  ToastProvider,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastClose,
  useToastManager,
};

export type { ToastProviderProps, ToastRootProps };
