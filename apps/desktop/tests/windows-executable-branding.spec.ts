import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { expect, it, type TestContext } from 'vitest'
import { verifyWindowsExecutableBranding } from '../scripts/windows-executable-branding.mjs'

async function executableFixture(test: TestContext, name: string, icon: 'application' | 'missing' | 'incomplete') {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-branding-'))
  test.onTestFinished(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
  const executable = NtExecutable.createEmpty(false, false)
  const resources = NtExecutableResource.from(executable)
  const version = Resource.VersionInfo.createEmpty()
  version.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: name, FileDescription: name })
  version.outputToResourceEntries(resources.entries)
  if (icon !== 'missing') {
    const artwork = Data.IconFile.from(await readFile(new URL('../resources/icon-windows.ico', import.meta.url)))
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033,
      (icon === 'incomplete' ? artwork.icons.slice(0, 1) : artwork.icons).map(entry => entry.data))
  }
  resources.outputResource(executable)
  const path = join(directory, 'application.exe')
  await writeFile(path, Buffer.from(executable.generate()))
  return path
}

it('accepts product metadata and the complete application icon without changing the executable', async (test) => {
  const path = await executableFixture(test, '西牧code', 'application')
  const before = await readFile(path)
  await verifyWindowsExecutableBranding(path)
  expect(await readFile(path)).toEqual(before)
})

it('rejects an executable that still identifies itself as Electron', async (test) => {
  const path = await executableFixture(test, 'Electron', 'application')
  await expect(verifyWindowsExecutableBranding(path)).rejects.toThrow('metadata must identify 西牧code')
})

it.for(['missing', 'incomplete'] as const)('rejects %s application icon resources', async (icon, test) => {
  const path = await executableFixture(test, '西牧code', icon)
  await expect(verifyWindowsExecutableBranding(path)).rejects.toThrow('icon must match icon-windows.ico')
})

it('rejects a changed icon bitmap even when its dimensions and entry count match', async (test) => {
  const path = await executableFixture(test, '西牧code', 'application')
  const executable = NtExecutable.from(await readFile(path))
  const resources = NtExecutableResource.from(executable)
  const bitmap = resources.entries.find(entry => entry.type === 3)!
  const changed = Buffer.from(bitmap.bin.slice(0))
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
  bitmap.bin = changed.buffer.slice(changed.byteOffset, changed.byteOffset + changed.byteLength)
  resources.outputResource(executable)
  await writeFile(path, Buffer.from(executable.generate()))
  await expect(verifyWindowsExecutableBranding(path)).rejects.toThrow('icon must match icon-windows.ico')
})
