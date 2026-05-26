/**
 * US-029: gate for the whole-project export path. The flag flips ON in apps
 * built with `VITE_SEEFLOW_PROJECT_EXPORT=1` (e.g. `bun run build` in a CI job
 * that targets the new seeflow.dev viewer). When OFF, the legacy single-flow
 * export path in `use-export-to-cloud.ts` keeps working unchanged.
 *
 * The flag has to flip on AFTER the seeflow-viewer cloud PR lands — the
 * studio publishes the new bundle layout (`seeflow.json` + `flows/<id>/...`)
 * and the cloud has to know how to unpack it.
 */
export const IS_PROJECT_EXPORT_ENABLED = import.meta.env.VITE_SEEFLOW_PROJECT_EXPORT === '1';
