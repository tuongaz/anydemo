/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SEEFLOW_PROJECT_EXPORT?: string;
  readonly VITE_SEEFLOW_CLOUD_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
