/** Verify the product name and application artwork embedded in Windows executables. */
import { readFile } from 'node:fs/promises'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

/**
 * Reject Electron defaults and incomplete icon resources in signed or unsigned packages.
 * @param {string} executablePath - Assembled Windows application executable.
 * @returns {Promise<void>} Resolves when metadata and every application-icon bitmap match the product.
 * @throws {Error} When executable resources contain a different name or icon.
 */
export async function verifyWindowsExecutableBranding(executablePath) {
  const executable = NtExecutable.from(await readFile(executablePath), { ignoreCert: true })
  const resources = NtExecutableResource.from(executable)
  const versions = Resource.VersionInfo.fromEntries(resources.entries)
  const branded = versions.some(version => version.getAllLanguagesForStringValues().some(language => {
    const values = version.getStringValues(language)
    return values.ProductName === '西牧code' && values.FileDescription === '西牧code'
  }))
  if (!branded) throw new Error(`Windows application metadata must identify 西牧code: ${executablePath}`)
  const expected = Data.IconFile.from(await readFile(new URL('../resources/icon-windows.ico', import.meta.url)))
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries)
  const matches = groups.filter(group => group.id === 1).some(group => {
    const actual = group.getIconItemsFromEntries(resources.entries)
    return actual.length === expected.icons.length && actual.every((item, index) => {
      const expectedItem = expected.icons[index].data
      const actualBytes = item.isRaw() ? item.bin : item.generate()
      const expectedBytes = expectedItem.isRaw() ? expectedItem.bin : expectedItem.generate()
      return Buffer.from(actualBytes).equals(Buffer.from(expectedBytes))
    })
  })
  if (!matches) throw new Error(`Windows application icon must match icon-windows.ico: ${executablePath}`)
}
