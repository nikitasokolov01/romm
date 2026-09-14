import type { RomioCandidate, RomioGame } from "@/services/api/romio";

export interface SavedRomioChoice {
  candidateId: string;
  jobId: string;
}

export function readSavedChoice(value: string): SavedRomioChoice | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("candidateId" in parsed) ||
      !("jobId" in parsed)
    )
      return null;
    if (
      typeof parsed.candidateId !== "string" ||
      typeof parsed.jobId !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.candidateId) ||
      !/^[a-f0-9]{64}$/.test(parsed.jobId)
    )
      return null;
    return { candidateId: parsed.candidateId, jobId: parsed.jobId };
  } catch {
    return null;
  }
}

export function canPrepare(candidate: RomioCandidate): boolean {
  return !candidate.cacheOnly || candidate.cached === true;
}

export function canPlayInBrowser(
  game: RomioGame,
  candidate: RomioCandidate,
): boolean {
  return (
    Boolean(game.browserCore) &&
    (!candidate.packaging || candidate.packaging === "zip") &&
    candidate.source.size <= 512 * 1024 ** 2
  );
}

export function fileBasename(candidate: RomioCandidate): string {
  return candidate.source.filePath.split(/[\\/]/).at(-1) || candidate.title;
}

export function sourceExtension(candidate: RomioCandidate): string {
  const extension =
    fileBasename(candidate).split(".").at(-1)?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,12}$/.test(extension) &&
    fileBasename(candidate).includes(".")
    ? extension
    : "rom";
}

export function progressPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value)
    ? value
    : null;
}
