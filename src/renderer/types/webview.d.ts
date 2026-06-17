import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { WebviewTag } from 'electron';

/**
 * Minimal JSX typing for Electron's <webview> custom element so TSX recognises
 * it. We only declare the attributes BrowserPane actually sets; the element's
 * imperative API (goBack/goForward/reload/getURL/…) comes from Electron's
 * `WebviewTag`, which is the element's ref/instance type.
 */
interface WebviewAttributes extends HTMLAttributes<WebviewTag> {
  src?: string;
  partition?: string;
  allowpopups?: boolean;
  useragent?: string;
  preload?: string;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<WebviewAttributes, WebviewTag>;
    }
  }
}
