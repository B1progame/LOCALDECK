/* Decides how an imported file may be shown in an iframe. Used by the player and the HTML editor preview.
   The decision depends on the file itself, never on the project type: a project can claim any type in its manifest. */

/** Runs scripts in an opaque origin, so the project cannot reach LocalDeck's storage or page. */
export const OPAQUE_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads allow-modals';
/** For files routed by the service worker. Its CSP sandbox header makes the document opaque before any script runs. */
export const ROUTED_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads allow-modals allow-same-origin';
/** PDFs never need scripts. */
export const PDF_SANDBOX = 'allow-downloads allow-same-origin';

export type FramePlan =
  /** An HTML page packed with all its files into one page (services/packPage). Works with and without the service worker. */
  | { kind: 'packed'; sandbox: string }
  | { kind: 'routed'; sandbox: string }
  | { kind: 'blob'; mime: 'text/html'; sandbox: string }
  /** Chrome refuses PDFs in sandboxed frames. The blob is forced to application/pdf, so it can never run as HTML. */
  | { kind: 'blob'; mime: 'application/pdf'; sandbox: undefined }
  | { kind: 'unavailable' };

export const isPdfPath = (path: string) => /\.pdf$/i.test(path);
const isHtmlPath = (path: string) => /\.html?$/i.test(path);

export function planFrame(path: string, packagePaths: string[], serviceWorkerActive: boolean): FramePlan {
  const pdf = isPdfPath(path);
  if (!pdf && !isHtmlPath(path)) return { kind: 'unavailable' };
  if (pdf) return serviceWorkerActive ? { kind: 'routed', sandbox: PDF_SANDBOX } : { kind: 'blob', mime: 'application/pdf', sandbox: undefined };
  // Browsers do not let a service worker serve a frame with an opaque origin, so every file goes into the page.
  void packagePaths;
  return { kind: 'packed', sandbox: OPAQUE_SANDBOX };
}
