/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare const __BON_DEV_CLAUDE_API_KEY__: string | null;
declare const __BON_STRAND__: string | null;
