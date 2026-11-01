/**
 * Reject Electron defaults and incomplete application-icon resources in Windows packages.
 * @param executablePath - Assembled Windows application executable, signed or unsigned.
 * @returns Resolves when the executable contains product metadata and every application-icon bitmap.
 * @throws When executable resources contain a different name or icon.
 */
export function verifyWindowsExecutableBranding(executablePath: string): Promise<void>
