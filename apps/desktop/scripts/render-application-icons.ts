/** Generate Desktop application, welcome, installer, and tray artwork from the supplied logo. */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries } from './render-tray-icon.ts'

const resources = new URL('../resources/', import.meta.url)
const source = await readFile(new URL('logo.jpg', resources))
const icon = await sharp(source).resize(1024, 1024, { fit: 'contain' }).png().toBuffer()
for (const name of ['icon.png', 'icon-windows.png', 'icon-macos.png']) await writeFile(new URL(name, resources), icon)
await writeFile(new URL('icon-windows.ico', resources), packIco(await Promise.all(
  [16, 24, 32, 48, 64, 128, 256].map(async size => ({ size, png: await sharp(icon).resize(size, size).png().toBuffer() })),
)))
await writeFile(new URL('tray-windows.ico', resources), packIco(await renderTrayIconEntries(icon)))
await writeFile(new URL('../renderer/assets/welcome-logo.png', import.meta.url),
  await sharp(source).resize(192, 192, { fit: 'contain' }).png().toBuffer())
for (const [name, width, height, edge] of [
  ['brand', 600, 196, 128], ['brand-2x', 1200, 392, 256],
  ['brand-dark', 600, 196, 128], ['brand-dark-2x', 1200, 392, 256],
  ['uninstaller-sidebar', 164, 314, 128],
] as const) {
  const image = await sharp(source).resize(edge, edge, { fit: 'contain' }).png().toBuffer()
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: image, gravity: 'center' }]).png()
    .toFile(fileURLToPath(new URL(`../installer/assets/${name}.png`, import.meta.url)))
}
