import { useSearchParams } from "react-router";
import { appIcon } from "@/app/branding";
import { SHIFT_DISCORD_URL, SHIFT_WEBSITE_URL, SHIFT_X_URL } from "@shared/links";
import "./AboutScreen.css";

export const AboutScreen = () => {
  const [searchParams] = useSearchParams();
  const productName = searchParams.get("name") ?? "Shift";
  const shiftBuildCommit = searchParams.get("commit") ?? "unknown";
  const version = searchParams.get("version") ?? "";

  return (
    <main className="about-window">
      <img src={appIcon} alt="" className="about-window-icon" />
      <div className="about-window-heading">
        <h1>{productName}</h1>
        {version ? <p>Version {version}</p> : null}
        <p>
          Build{" "}
          {shiftBuildCommit === "unknown" ? (
            "unknown"
          ) : (
            <a
              href={`https://github.com/shift-editor/shift/commit/${shiftBuildCommit}`}
              target="_blank"
              rel="noreferrer"
            >
              {shiftBuildCommit.slice(0, 8)}
            </a>
          )}
        </p>
      </div>
      <p className="about-window-tagline">A font editor for drawing, spacing, and shaping type.</p>
      <nav className="about-window-links" aria-label="Shift links">
        <a href={SHIFT_WEBSITE_URL} target="_blank" rel="noreferrer">
          Website
        </a>
        <a href={SHIFT_DISCORD_URL} target="_blank" rel="noreferrer">
          Discord
        </a>
        <a href={SHIFT_X_URL} target="_blank" rel="noreferrer">
          X / Twitter
        </a>
      </nav>
      <p className="about-window-copyright">Copyright © 2026 Shift</p>
    </main>
  );
};
