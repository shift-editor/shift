import { useState } from "react";
import { Button, Textarea } from "@shift/ui";
import { Titlebar } from "@/components/chrome/Titlebar";
import {
  SHIFT_FEEDBACK_DISCORD_URL,
  SHIFT_FEEDBACK_EMAIL,
  SHIFT_NEW_ISSUE_URL,
} from "@shared/links";

export const FeedbackScreen = () => {
  const [feedback, setFeedback] = useState("");
  const feedbackEmailUrl = `mailto:${SHIFT_FEEDBACK_EMAIL}?body=${encodeURIComponent(feedback)}`;

  return (
    <main className="fixed inset-0 flex min-h-0 flex-col bg-surface text-primary">
      <Titlebar closeOnly onClose={() => window.close()} />
      <section className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <header className="shrink-0">
          <h1 className="text-base font-semibold">Feedback</h1>
          <p className="mt-1 text-sm text-secondary">
            You can also send a message on{" "}
            <a
              href={SHIFT_FEEDBACK_DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Discord
            </a>{" "}
            or{" "}
            <a
              href={SHIFT_NEW_ISSUE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              open an issue on GitHub
            </a>
            .
          </p>
        </header>
        <label className="mt-4 flex min-h-0 flex-1 flex-col gap-2 text-sm font-medium">
          Email message
          <Textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.select();
                return;
              }

              if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;

              event.preventDefault();
              if (feedback.trim().length === 0) return;

              window.open(feedbackEmailUrl, "_blank", "noopener,noreferrer");
            }}
            className="min-h-0 flex-1 resize-none p-3 font-normal"
          />
        </label>
        <div className="mt-4 flex shrink-0 items-center gap-2">
          <Button onClick={() => window.close()}>Cancel</Button>
          <Button
            variant="primary"
            disabled={feedback.trim().length === 0}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onClick={() => window.open(feedbackEmailUrl, "_blank", "noopener,noreferrer")}
          >
            Send Feedback
            <kbd aria-hidden="true" className="font-sans text-xs opacity-80">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </section>
    </main>
  );
};
