/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_ORIGIN?: string;
  readonly VITE_TMDB_API_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}