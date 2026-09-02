import { useSearchParams } from "react-router";
import { appIcon } from "@/app/branding";
import { Titlebar } from "@/components/chrome/Titlebar";
import { SHIFT_DISCORD_URL, SHIFT_WEBSITE_URL, SHIFT_X_URL } from "@shared/links";

export const AboutScreen = () => {
  const [searchParams] = useSearchParams();
  const productName = searchParams.get("name") ?? "Shift";
  const shiftBuildCommit = searchParams.get("commit") ?? "unknown";
  const version = searchParams.get("version") ?? "";

  return (
    <main className="flex h-screen flex-col bg-surface text-primary">
      <Titlebar closeOnly onClose={() => window.close()} />
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
        <img src={appIcon} alt="" className="h-24 w-24 drop-shadow-md" />
        <div className="mt-2.5 flex flex-col gap-0.5">
          <h1 className="text-base font-semibold">{productName}</h1>
          {version ? <p className="text-sm text-secondary">Version {version}</p> : null}
          <p className="text-sm text-secondary">
            Build{" "}
            {shiftBuildCommit === "unknown" ? (
              "unknown"
            ) : (
              <a
                href={`https://github.com/shift-editor/shift/commit/${shiftBuildCommit}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-accent hover:underline"
              >
                {shiftBuildCommit.slice(0, 8)}
              </a>
            )}
          </p>
        </div>
        <p className="mt-3.5 text-sm">A font editor for drawing, spacing, and shaping type.</p>
        <nav className="mt-4 flex gap-4 text-sm" aria-label="Shift links">
          <a
            href={SHIFT_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Website
          </a>
          <a
            href={SHIFT_DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Discord
          </a>
          <a
            href={SHIFT_X_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            X / Twitter
          </a>
        </nav>
        <p className="mt-3.5 text-sm text-secondary">Copyright © 2026 Shift</p>
      </section>
    </main>
  );
};
