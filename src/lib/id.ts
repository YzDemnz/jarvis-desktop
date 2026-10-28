let counter = 0;
export function uid(prefix = 'x'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
