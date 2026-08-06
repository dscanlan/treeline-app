export type SidebarMode = 'working' | 'library';

export function sidebarRepoDisclosureKey(mode: SidebarMode, repoPath: string): string {
  return `${mode}:${repoPath}`;
}

/** Parent groups default open; only explicit collapses need storing. */
export function sidebarLocationIsOpen(
  collapsedLocations: readonly string[],
  parentPath: string,
): boolean {
  return !collapsedLocations.includes(parentPath);
}

export function toggleSidebarLocation(
  collapsedLocations: readonly string[],
  parentPath: string,
): string[] {
  return collapsedLocations.includes(parentPath)
    ? collapsedLocations.filter((path) => path !== parentPath)
    : [...collapsedLocations, parentPath];
}

/** Repos retain their established defaults until the user explicitly toggles one. */
export function sidebarRepoIsOpen(
  repoOpen: Readonly<Record<string, boolean>>,
  mode: SidebarMode,
  repoPath: string,
): boolean {
  return repoOpen[sidebarRepoDisclosureKey(mode, repoPath)] ?? mode === 'working';
}

export function setSidebarRepoDisclosure(
  repoOpen: Readonly<Record<string, boolean>>,
  mode: SidebarMode,
  repoPath: string,
  open: boolean,
): Record<string, boolean> {
  return { ...repoOpen, [sidebarRepoDisclosureKey(mode, repoPath)]: open };
}
