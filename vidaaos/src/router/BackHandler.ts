// Layered Back handler stack (topmost wins). Mirrors Android BackHandler.
// The Router invokes handleBack() on Escape/Backspace/BrowserBack; if no
// handler consumes, the router falls back to history.back().

type BackHandler = () => boolean; // returns true if consumed

const stack: BackHandler[] = [];

export function pushBackHandler(fn: BackHandler): () => void {
  stack.push(fn);
  return () => {
    const i = stack.indexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true;
  }
  return false;
}