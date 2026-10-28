import type { ExecutionNetwork, ExecutionPolicy, ExecutionRealm, ExecutionUserPolicy } from './types';
import { defaultRunBudget } from './RunBudget';

const NETWORK: Record<ExecutionRealm, ExecutionNetwork> = {
  BROKERED: 'TOOL_POLICY', WEB_ISOLATED: 'ALLOWLIST', STRONG_ISOLATED: 'OFF',
  PROVIDER_NATIVE: 'PROVIDER_DEFINED', FULL_NATIVE: 'SYSTEM',
};

/** Constructed by main from its own policy and original-input receipt, never tool arguments. */
export function authorityExecutionPolicy(accessMode: 'FULL' | 'RESTRICTED', authoritativeStrong = false): ExecutionPolicy {
  return { accessMode, authoritativeStrong, user: 'NORMAL_USER', allowProviderNative: false,
    allowFullNative: accessMode === 'FULL', requireExplicitFullNative: false, network: { ...NETWORK },
    securityRequirements: {}, securityFallback: 'NONE', budget: defaultRunBudget() };
}

/** @deprecated EF-1/EF-2A laboratory compatibility only; production uses authorityExecutionPolicy. */
export function executionPolicy(user: ExecutionUserPolicy = 'NORMAL_USER', options: { allowProviderNative?: boolean; explicitFullNative?: boolean } = {}): ExecutionPolicy {
  return {
    user,
    allowProviderNative: options.allowProviderNative === true,
    allowFullNative: user === 'DEVELOPER' && options.explicitFullNative === true,
    requireExplicitFullNative: true,
    network: { ...NETWORK },
    securityRequirements: {},
    securityFallback: 'NONE',
    budget: defaultRunBudget(),
  };
}

export function realmAllowed(realm: ExecutionRealm, policy: ExecutionPolicy, explicitRealm: ExecutionRealm | null = null): boolean {
  if (policy.accessMode && realm === 'FULL_NATIVE') return policy.accessMode === 'FULL' && policy.allowFullNative;
  if (realm === 'FULL_NATIVE') return policy.user === 'DEVELOPER' && policy.allowFullNative && explicitRealm === 'FULL_NATIVE';
  if (realm === 'PROVIDER_NATIVE') return policy.allowProviderNative;
  return true;
}
