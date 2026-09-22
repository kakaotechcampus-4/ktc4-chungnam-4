// 브라우저에 노출되는 값입니다. 여기에 비밀을 넣지 않습니다.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MSW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
