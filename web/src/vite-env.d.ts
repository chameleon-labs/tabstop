/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The API origin. Unset in development, so requests are same-origin and go
   * through the dev proxy in `vite.config.ts`; set to the real API origin for a
   * deployed build, which is what makes the request cross-origin and
   * `credentials: 'include'` load-bearing.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
