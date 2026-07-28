// Artifact/SDK compatibility contract shapes (ADR 29 / plan §9.4).

/** Capability-contract version, versioned independently of the REST API. */
export type CapabilityContract = `cap.v${number}`;

/** Compatibility pins an artifact records at publish time: the SDK major and
 *  channel it was authored against, so serve can inject the right major later. */
export interface ArtifactSdkPin {
  major: number;
  channel: string;
}
