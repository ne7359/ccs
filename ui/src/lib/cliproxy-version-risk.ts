function normalizeVersionParts(version: string): number[] {
  return version.replace(/-\d+$/, '').split('.').map(Number);
}

export function compareCliproxyVersions(a: string, b: string): number {
  const aParts = normalizeVersionParts(a);
  const bParts = normalizeVersionParts(b);

  for (let index = 0; index < 3; index += 1) {
    const aPart = aParts[index] || 0;
    const bPart = bParts[index] || 0;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

export function isCliproxyVersionExperimental(version: string, maxStableVersion: string): boolean {
  return compareCliproxyVersions(version, maxStableVersion) > 0;
}

export function isCliproxyVersionInRange(version: string, min: string, max: string): boolean {
  return compareCliproxyVersions(version, min) >= 0 && compareCliproxyVersions(version, max) <= 0;
}
