import { useState } from "react";
import { Button, Textarea } from "@shift/ui";
import {
  SHIFT_FEEDBACK_DISCORD_URL,
  SHIFT_FEEDBACK_EMAIL,
  SHIFT_NEW_ISSUE_URL,
} from "@shared/links";

export const FeedbackScreen = () => {
  const [feedback, setFeedback] = useState("");
  const feedbackEmailUrl = `mailto:${SHIFT_FEEDBACK_EMAIL}?body=${encodeURIComponent(feedback)}`;

  return (
    <main className="fixed inset-0 flex flex-col bg-canvas px-8 pb-7 pt-12 text-primary">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <label className="mt-5 flex min-h-0 flex-1 flex-col gap-2 text-sm font-medium">
        What would you like to share?
        <Textarea
          autoFocus
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          className="min-h-0 flex-1 resize-none p-3 font-normal"
        />
      </label>
      <div className="mt-5 flex items-center justify-between">
        <div className="flex gap-4 text-sm">
          <a
            href={SHIFT_NEW_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Report a Problem…
          </a>
          <a
            href={SHIFT_FEEDBACK_DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Discord
          </a>
        </div>
        <Button
          variant="primary"
          disabled={feedback.trim().length === 0}
          onClick={() => window.open(feedbackEmailUrl, "_blank", "noopener,noreferrer")}
        >
          Email Feedback
        </Button>
      </div>
    </main>
  );
};
