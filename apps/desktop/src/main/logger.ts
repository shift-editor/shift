function formatDetails(details: unknown[]): string {
  if (details.length === 0) return "";

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${details.map(String).join(" ")}`;
  }
}

export function mainLog(scope: string, message: string, ...details: unknown[]): void {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[shift:${scope}] ${timestamp} ${message}${formatDetails(details)}\n`);
}
