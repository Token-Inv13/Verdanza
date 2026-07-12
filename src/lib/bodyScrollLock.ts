type ScrollLockSnapshot = {
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  htmlOverflow: string;
  scrollY: number;
};

const activeLocks = new Set<symbol>();
let originalValues: ScrollLockSnapshot | null = null;

export function acquireBodyScrollLock() {
  if (typeof document === "undefined") return () => undefined;

  const lockId = Symbol("body-scroll-lock");
  if (activeLocks.size === 0) {
    const scrollY = window.scrollY;
    originalValues = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
      htmlOverflow: document.documentElement.style.overflow,
      scrollY,
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
  }

  activeLocks.add(lockId);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks.delete(lockId);
    restoreIfUnlocked();
  };
}

export function ensureBodyScrollUnlocked() {
  if (typeof document === "undefined") return;
  if (activeLocks.size === 0) restoreIfUnlocked();
}

function restoreIfUnlocked() {
  if (typeof document === "undefined" || activeLocks.size > 0) return;

  if (originalValues) {
    const scrollY = originalValues.scrollY;
    document.body.style.overflow = originalValues.bodyOverflow;
    document.body.style.position = originalValues.bodyPosition;
    document.body.style.top = originalValues.bodyTop;
    document.body.style.width = originalValues.bodyWidth;
    document.documentElement.style.overflow = originalValues.htmlOverflow;
    originalValues = null;
    window.scrollTo(0, scrollY);
    return;
  }

  if (document.body.style.overflow === "hidden") {
    document.body.style.overflow = "";
  }
  if (document.body.style.position === "fixed") {
    document.body.style.position = "";
  }
  if (document.body.style.top.startsWith("-")) {
    document.body.style.top = "";
  }
  if (document.body.style.width === "100%") {
    document.body.style.width = "";
  }
  if (document.documentElement.style.overflow === "hidden") {
    document.documentElement.style.overflow = "";
  }
}
