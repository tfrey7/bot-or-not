/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare const __DEV_CLAUDE_API_KEY__: string | null;
declare const __STRAND__: string | null;
declare const __STRAND_COLOR__: string | null;
