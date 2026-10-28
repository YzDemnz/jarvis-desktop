import { Fragment, forwardRef, createElement } from 'react';
import type { ReactNode } from 'react';

/**
 * Harness-only framer-motion. Renders the underlying tag and drops the
 * animation props. Exit animations become immediate unmounts, which makes the
 * DOM assertions deterministic — and also means a panel that fails to unmount
 * shows up as a real leak instead of being masked by an exit transition.
 */
const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap',
  'whileInView', 'whileFocus', 'whileDrag', 'layout', 'layoutId', 'drag', 'dragConstraints',
  'onAnimationComplete', 'onAnimationStart', 'custom', 'style0',
]);

function strip(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (MOTION_PROPS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function motionTag(tag: string) {
  const Component = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    createElement(tag, { ...strip(props), ref }));
  Component.displayName = `motion.${tag}`;
  return Component;
}

export const motion = new Proxy({} as Record<string, ReturnType<typeof motionTag>>, {
  get: (cache, tag: string) => {
    if (!cache[tag]) cache[tag] = motionTag(tag);
    return cache[tag];
  },
});

export function AnimatePresence({ children }: { children?: ReactNode }) {
  return createElement(Fragment, null, children);
}

export function useReducedMotion(): boolean {
  return false;
}
