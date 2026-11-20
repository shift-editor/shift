import { useEffect, type ReactNode } from "react";
import { effect } from "@shift/editor/signals";
import { ToastProvider, ToastRoot, ToastTitle, ToastViewport, useToastManager } from "@shift/ui";
import { appNotificationCell } from "@/lib/notifications/notify";

/** How long a notification stays up: long enough to read a sentence. */
const NOTIFICATION_TIMEOUT_MS = 4000;

/**
 * Shows every `notify` message as a toast at the bottom of the window, so a
 * command that cannot run can say why instead of doing nothing.
 */
export const AppNotifications = ({ children }: { readonly children: ReactNode }) => (
  <ToastProvider timeout={NOTIFICATION_TIMEOUT_MS}>
    {children}
    <ToastViewport className="top-auto bottom-12">
      <NotificationList />
    </ToastViewport>
  </ToastProvider>
);

const NotificationList = () => {
  const { toasts, add } = useToastManager();

  useEffect(() => {
    // The first run reads a notification from before this mounted, which is old news.
    const announced = appNotificationCell.peek();
    const subscription = effect(() => {
      const notification = appNotificationCell.value;
      if (!notification || notification === announced) return;

      add({ title: notification.message });
    });

    return () => subscription.dispose();
  }, [add]);

  return toasts.map((toast) => (
    <ToastRoot key={toast.id} toast={toast}>
      <ToastTitle>{String(toast.title)}</ToastTitle>
    </ToastRoot>
  ));
};
