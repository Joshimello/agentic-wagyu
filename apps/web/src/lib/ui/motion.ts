import { gsap } from 'gsap';

export function reducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function popover(node: Element) {
  return {
    duration: reducedMotion() ? 0 : 180,
    easing: gsap.parseEase('power3.out'),
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * -5}px) scale(${0.98 + t * 0.02});`,
  };
}
