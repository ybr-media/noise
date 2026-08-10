"use client";

import { useEffect, useRef, useState } from "react";

export function usePullRefresh(loading: boolean, onRefresh: () => void) {
  const [pullDistance, setPullDistance] = useState(0);
  const pullStart = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshShellRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const shell = refreshShellRef.current;
    if (!shell) return;
    const touchStart = (event: TouchEvent) => {
      if (window.scrollY > 0 || (event.target as HTMLElement).closest("input,button,a,audio")) return;
      pullStart.current = event.touches[0]?.clientY ?? null;
    };
    const touchMove = (event: TouchEvent) => {
      if (pullStart.current === null || window.scrollY > 0) return;
      const distance = (event.touches[0]?.clientY ?? 0) - pullStart.current;
      if (distance <= 0) return;
      event.preventDefault();
      const nextDistance = Math.min(76, distance);
      pullDistanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    };
    const touchEnd = () => {
      if (pullDistanceRef.current >= 56 && !loading) void onRefresh();
      pullStart.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };
    const options: AddEventListenerOptions = { passive: false };
    shell.addEventListener("touchstart", touchStart, options);
    shell.addEventListener("touchmove", touchMove, options);
    shell.addEventListener("touchend", touchEnd, options);
    shell.addEventListener("touchcancel", touchEnd, options);
    return () => {
      shell.removeEventListener("touchstart", touchStart, options);
      shell.removeEventListener("touchmove", touchMove, options);
      shell.removeEventListener("touchend", touchEnd, options);
      shell.removeEventListener("touchcancel", touchEnd, options);
    };
  }, [loading, onRefresh]);
  return { pullDistance, refreshShellRef };
}
