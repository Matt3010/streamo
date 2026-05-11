type FullscreenRequestable = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenExitableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function isLandscapeTouchViewport(): boolean {
  return window.matchMedia('(orientation: landscape)').matches
    && window.matchMedia('(pointer: coarse)').matches;
}

export async function requestElementFullscreen(element: HTMLElement | null | undefined): Promise<boolean> {
  if (!element) return false;
  if (document.fullscreenElement === element || document.fullscreenElement) return false;

  const request = getFullscreenRequest(element as FullscreenRequestable);
  if (!request) return false;

  try {
    await request();
    return true;
  } catch {
    return false;
  }
}

export async function exitDocumentFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore unsupported or denied exits.
    }
    return;
  }

  const webkitExit = (document as FullscreenExitableDocument).webkitExitFullscreen;
  if (!webkitExit) return;

  try {
    await webkitExit.call(document);
  } catch {
    // Ignore unsupported or denied exits.
  }
}

function getFullscreenRequest(element: FullscreenRequestable): (() => Promise<void> | void) | null {
  if (typeof element.requestFullscreen === 'function') {
    return element.requestFullscreen.bind(element);
  }
  if (typeof element.webkitRequestFullscreen === 'function') {
    return element.webkitRequestFullscreen.bind(element);
  }
  return null;
}
