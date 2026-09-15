/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RomioCapabilitiesSchema } from './RomioCapabilitiesSchema';
import type { RomioCategorySchema } from './RomioCategorySchema';
import type { RomioSystemSchema } from './RomioSystemSchema';
export type RomioManifestSchema = {
    id: string;
    version: string;
    name: string;
    systems: Array<RomioSystemSchema>;
    categories: Array<RomioCategorySchema>;
    capabilities: RomioCapabilitiesSchema;
    catalogReady: boolean;
    language?: 'en' | 'es' | 'fr' | 'ru' | 'zh' | 'ja';
};
