/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RomioGameSchema } from './RomioGameSchema';
export type RomioMetadataSyncItemSchema = {
    gameId: string;
    status: 'matched' | 'unmatched' | 'ambiguous' | 'unsupported' | 'failed';
    game?: (RomioGameSchema | null);
    error?: (string | null);
};
