/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RomioCandidateSchema } from './RomioCandidateSchema';
export type RomioJobSchema = {
    id: string;
    state: 'submitting' | 'reconciling' | 'downloading' | 'ready' | 'failed';
    progress: number;
    error?: (string | null);
    updatedAt: number;
    candidate: RomioCandidateSchema;
    stage?: ('account_lookup' | 'source_metadata' | 'provider_submit' | 'inspect' | 'verify_file' | 'submitting' | 'reconciling' | 'downloading' | 'ready' | 'failed' | null);
    checkedAt?: (number | null);
};
