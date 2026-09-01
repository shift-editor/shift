import { useState } from "react";
import { Button, Textarea } from "@shift/ui";
import { appIcon } from "@/app/branding";
import {
  SHIFT_FEEDBACK_DISCORD_URL,
  SHIFT_FEEDBACK_EMAIL,
  SHIFT_NEW_ISSUE_URL,
} from "@shared/links";
import "./FeedbackScreen.css";

export const FeedbackScreen = () => {
  const [feedback, setFeedback] = useState("");
  const feedbackEmailUrl = `mailto:${SHIFT_FEEDBACK_EMAIL}?body=${encodeURIComponent(feedback)}`;

  return (
    <main className="feedback-window">
      <section className="feedback-window-content">
        <img src={appIcon} alt="" className="feedback-window-icon" />
        <div className="feedback-window-copy">
          <h1>Feedback</h1>
          <p>Drop us a message in Discord or send us an email.</p>
        </div>
        <label className="feedback-window-field">
          Email message
          <Textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            className="feedback-window-textarea"
          />
        </label>
        <div className="feedback-window-actions">
          <a
            href={SHIFT_FEEDBACK_DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="feedback-window-button"
          >
            Open Discord
          </a>
          <Button
            variant="primary"
            disabled={feedback.trim().length === 0}
            className="feedback-window-primary-button"
            onClick={() => window.open(feedbackEmailUrl, "_blank", "noopener,noreferrer")}
          >
            Email Feedback
          </Button>
        </div>
        <a
          href={SHIFT_NEW_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          className="feedback-window-report-link"
        >
          Report a Problem…
        </a>
      </section>
    </main>
  );
};
