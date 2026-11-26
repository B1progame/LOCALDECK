/* Decides how an imported file may be shown in an iframe. Used by the player and the HTML editor preview.
   The decision depends on the file itself, never on the project type: a project can claim any type in its manifest. */

/** Runs scripts in an opaque origin, so the project cannot reach LocalDeck's storage or page. */
export const OPAQUE_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads allow-modals';
/** For files routed by the service worker. Its CSP sandbox header makes the document opaque before any script runs. */
export const ROUTED_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads allow-modals allow-same-origin';
/** PDFs never need scripts. */
export const PDF_SANDBOX = 'allow-downloads allow-same-origin';

export type FramePlan =
  | { kind: 'routed'; sandbox: string }
  | { kind: 'blob'; mime: 'text/html'; sandbox: string }
  /** Chrome refuses PDFs in sandboxed frames. The blob is forced to application/pdf, so it can never run as HTML. */
  | { kind: 'blob'; mime: 'application/pdf'; sandbox: undefined }
  | { kind: 'unavailable' };

export const isPdfPath = (path: string) => /\.pdf$/i.test(path);
const isHtmlPath = (path: string) => /\.html?$/i.test(path);
const isCodePath = (path: string) => /\.(html?|css|m?js)$/i.test(path);

export function planFrame(path: string, packagePaths: string[], serviceWorkerActive: boolean): FramePlan {
  const pdf = isPdfPath(path);
  if (!pdf && !isHtmlPath(path)) return { kind: 'unavailable' };
  if (serviceWorkerActive) return { kind: 'routed', sandbox: pdf ? PDF_SANDBOX : ROUTED_SANDBOX };
  if (pdf) return { kind: 'blob', mime: 'application/pdf', sandbox: undefined };
  // Without the service worker, relative files cannot be routed, so only single-file pages can run.
  return packagePaths.filter(isCodePath).length === 1 ? { kind: 'blob', mime: 'text/html', sandbox: OPAQUE_SANDBOX } : { kind: 'unavailable' };
}
