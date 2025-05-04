declare module 'katex/contrib/auto-render' {
  interface AutoRenderOptions {
    delimiters: Array<{
      left: string;
      right: string;
      display: boolean;
    }>;
    throwOnError?: boolean;
  }

  function renderMathInElement(element: HTMLElement, options: AutoRenderOptions): void;
  export default renderMathInElement;
} 