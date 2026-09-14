import type {
  RomioCandidateSchema,
  RomioCatalogSchema,
  RomioConnectionSchema,
  RomioGameSchema,
  RomioJobSchema,
  RomioManifestSchema,
  RomioSourcesSchema,
  RomioMetadataStatusSchema,
  RomioMetadataSyncSchema,
} from "@/__generated__";
import api from "@/services/api";

export type RomioGame = RomioGameSchema;
export type RomioCandidate = RomioCandidateSchema;
export type RomioJob = RomioJobSchema;
export type RomioManifest = RomioManifestSchema;

export default {
  connection: () => api.get<RomioConnectionSchema>("/romio/connection"),
  connect: (link: string) =>
    api.post<RomioConnectionSchema>("/romio/connection", { link }),
  disconnect: () => api.delete("/romio/connection"),
  manifest: () => api.get<RomioManifestSchema>("/romio/manifest"),
  metadata: () => api.get<RomioMetadataStatusSchema>("/romio/metadata"),
  syncMetadata: (gameIds: string[]) =>
    api.post<RomioMetadataSyncSchema>("/romio/metadata/sync", { gameIds }),
  catalog: (
    params: { system: string; category: string; q: string; offset: number },
    signal?: AbortSignal,
  ) => api.get<RomioCatalogSchema>("/romio/catalog", { params, signal }),
  game: (id: string) =>
    api.get<RomioGameSchema>(`/romio/games/${encodeURIComponent(id)}`),
  sources: (id: string, offset = 0) =>
    api.post<RomioSourcesSchema>(
      `/romio/games/${encodeURIComponent(id)}/sources`,
      { offset },
    ),
  acquire: (candidateId: string) =>
    api.post<RomioJobSchema>("/romio/acquisitions", { candidateId }),
  job: (id: string) =>
    api.get<RomioJobSchema>(`/romio/acquisitions/${encodeURIComponent(id)}`),
  link: (id: string) =>
    api.post<{ url: string }>(
      `/romio/acquisitions/${encodeURIComponent(id)}/link`,
      {},
    ),
  contentUrl: (id: string) =>
    `/api/romio/acquisitions/${encodeURIComponent(id)}/content`,
};
