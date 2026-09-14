/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RomioSourceSchema } from './RomioSourceSchema';
export type RomioCandidateSchema = {
    id: string;
    title: string;
    system: string;
    region: string;
    revision: string;
    source: RomioSourceSchema;
    origin: string;
    provenance: string;
    totalSize: number;
    score: number;
    reasons: Array<string>;
    cached: (boolean | null);
    packaging?: ('zip' | '7z' | 'rar' | null);
    requiresExtraction?: (boolean | null);
    cacheOnly?: (boolean | null);
    contentsVerified?: (boolean | null);
    collectionLabel?: (string | null);
};
