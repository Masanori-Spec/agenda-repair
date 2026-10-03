/** Minimal page lifecycle coordinator, independent of the DOM and solver. */
export function createPageLifecycle({ isRunning, interrupt, dispose, restore }) {
  let interrupted = false;
  return {
    pagehide() {
      if (isRunning()) {
        interrupted = true;
        interrupt();
      } else {
        dispose();
      }
    },
    pageshow() {
      if (!interrupted) return;
      interrupted = false;
      restore();
    },
  };
}
