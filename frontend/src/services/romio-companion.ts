const COMPANION_ORIGIN = "http://127.0.0.1:43821";
export const companionSettingsUrl = COMPANION_ORIGIN;

export interface CompanionProfile {
  id: string;
  label: string;
  systems: string[];
}
export interface CompanionCapabilities {
  version: string;
  deviceId: string;
  formats: string[];
  systems: string[];
  maxDownloadBytes: number;
  maxExtractedBytes: number;
  pairingRequired: boolean;
}
export interface CompanionStatus {
  paired: boolean;
  deviceId: string;
  profiles: CompanionProfile[];
  capabilities: CompanionCapabilities;
}
export interface CompanionJob {
  id: string;
  state: "downloading" | "paused" | "extracting" | "installed" | "failed";
  received: number;
  total: number;
  error?: string;
}
export interface CompanionInstall {
  sourceId: string;
  title: string;
  system: string;
  size: number;
  sha256: string;
  packaging: "raw" | "zip";
  downloadUrl: string;
  launch: boolean;
  profileId: string;
}

async function request<T>(
  path: string,
  token: string | null,
  body?: object,
): Promise<T> {
  const response = await fetch(`${COMPANION_ORIGIN}${path}`, {
    method: body ? "POST" : "GET",
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("COMPANION_REQUEST_FAILED");
  return response.json() as Promise<T>;
}

export const companion = {
  pair: (code: string) =>
    request<{
      token: string;
      deviceId: string;
      capabilities: CompanionCapabilities;
    }>("/v1/pair", null, { code }),
  status: (token: string) => request<CompanionStatus>("/v1/status", token),
  install: (token: string, body: CompanionInstall) =>
    request<CompanionJob>("/v1/install", token, body),
  job: (token: string, id: string) =>
    request<CompanionJob>(`/v1/jobs/${encodeURIComponent(id)}`, token),
  resume: (token: string, id: string, downloadUrl: string) =>
    request<CompanionJob>(`/v1/jobs/${encodeURIComponent(id)}/resume`, token, {
      downloadUrl,
    }),
  launch: (token: string, id: string, profileId: string) =>
    request<{ launched: boolean }>(
      `/v1/library/${encodeURIComponent(id)}/launch`,
      token,
      { profileId },
    ),
};
