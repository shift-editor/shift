import fs from "node:fs";
import path from "node:path";
import type {
  SessionViewResume,
  SessionViewResumeOpenSession,
  ViewResumeFile,
} from "../../shared/viewResume";
import { emptySessionViewResume } from "../../shared/viewResume";

/**
 * Persists per-session view resume payloads under the app user data directory.
 *
 * @remarks
 * Plain module (not a domain Store wrapper). Keys are font session ids.
 */
export class ViewResumePersistence {
  readonly #filePath: string;
  #file: ViewResumeFile;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.#file = readFile(filePath);
  }

  get(sessionId: string): SessionViewResume | null {
    return this.#file.sessions[sessionId] ?? null;
  }

  set(sessionId: string, resume: SessionViewResume): void {
    this.#file = {
      ...this.#file,
      sessions: { ...this.#file.sessions, [sessionId]: resume },
    };
    writeFile(this.#filePath, this.#file);
  }

  transfer(fromSessionId: string, toSessionId: string): void {
    const resume = this.#file.sessions[fromSessionId];
    if (!resume) return;

    const sessions = { ...this.#file.sessions, [toSessionId]: resume };
    delete sessions[fromSessionId];
    this.#file = { ...this.#file, sessions };
    writeFile(this.#filePath, this.#file);
  }

  consume(sessionId: string): SessionViewResume | null {
    const resume = this.#file.sessions[sessionId] ?? null;
    if (!resume) return null;

    const sessions = { ...this.#file.sessions };
    delete sessions[sessionId];
    this.#file = { ...this.#file, sessions };
    writeFile(this.#filePath, this.#file);
    return resume;
  }

  setOpenSessionsAtQuit(sessions: readonly SessionViewResumeOpenSession[]): void {
    this.#file = { ...this.#file, openSessionsAtQuit: [...sessions] };
    writeFile(this.#filePath, this.#file);
  }

  takeOpenSessionsAtQuit(): SessionViewResumeOpenSession[] {
    const openSessionsAtQuit = this.#file.openSessionsAtQuit;
    if (openSessionsAtQuit.length === 0) return [];

    this.#file = { ...this.#file, openSessionsAtQuit: [] };
    writeFile(this.#filePath, this.#file);
    return openSessionsAtQuit;
  }
}

export function workspaceLoadHashFromResume(resume: SessionViewResume | null): string {
  const glyphId = resume?.route?.glyphId;
  if (glyphId && glyphId.length > 0) {
    return `/editor/${encodeURIComponent(glyphId)}`;
  }

  return "/home";
}

function readFile(filePath: string): ViewResumeFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { sessions: {}, openSessionsAtQuit: [] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { sessions: {}, openSessionsAtQuit: [] };
  }

  const record = parsed as Record<string, unknown>;
  const sessions =
    typeof record.sessions === "object" &&
    record.sessions !== null &&
    !Array.isArray(record.sessions)
      ? (record.sessions as Record<string, SessionViewResume>)
      : {};
  const openSessionsAtQuit = Array.isArray(record.openSessionsAtQuit)
    ? record.openSessionsAtQuit.filter(isOpenSession)
    : [];

  return { sessions, openSessionsAtQuit };
}

function writeFile(filePath: string, file: ViewResumeFile): void {
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(file, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    console.warn("failed to persist view resume", error);
  }
}

function isOpenSession(value: unknown): value is SessionViewResumeOpenSession {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string";
}
