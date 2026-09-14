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
};
