// Artifact/SDK compatibility contract — ADR 29 / architecture_plan §9.4.
// Versioned SDK paths (/sdk/v<major>/...) are immutable and frozen once published;
// the unversioned alias (/sdk/...) floats to the current major for backward compat.

export const SDK_MAJOR = 1;
export const SUPPORTED_SDK_MAJORS = [1];
export const CAPABILITY_CONTRACT = 'cap.v1';

// Versioned paths never change content, so cache them hard. The unversioned alias
// keeps its short, revalidated cache because it floats.
export const SDK_IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export function isSupportedSdkMajor(major: number): boolean {
  return SUPPORTED_SDK_MAJORS.includes(major);
}
