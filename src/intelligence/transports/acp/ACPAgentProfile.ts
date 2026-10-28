export interface ACPAgentProfile {
  id: string; name: string; command: string; args: string[]; version: string;
  capabilities: string[]; authenticationMode: 'OFFICIAL_MANAGED' | 'FAKE';
  supportsResume: boolean; supportsCancel: boolean; supportsUsage: boolean;
  supportsTools: boolean; supportsMCP: boolean;
  workingDirectoryPolicy: 'TEMP_ONLY'; environmentPolicy: 'ALLOWLIST';
  environment?: Record<string, string>;
  /** A prompt is prohibited until ALL direct tool paths are proven mediated. */
  promptSafety: 'CLIENT_MEDIATED' | 'UNVERIFIED';
}
