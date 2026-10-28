export * from './ai';
export * from './agent';
export * from './workspace';
export * from './browser';
export * from './files';
export * from './markets';
export * from './vault';
export * from './machine';
export * from './desktop';
export * from './dev';

export const MODULE_IDS = [
  'home',
  'browser',
  'markets',
  'trading',
  'research',
  'projects',
  'coding',
  'files',
  'vault',
  'storage',
  'automations',
  'history',
  'settings',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];
