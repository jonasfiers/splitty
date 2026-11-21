// Phone photos of a receipt are 3–12 MB; the text stays readable at a far
// smaller size. Before uploading, a photo is redrawn at most MAX_EDGE pixels
// on its long side as a JPEG, which also drops its EXIF data (location,
// device): always, also for a small photo. A PNG (a screenshot: no location)
// is only swapped when the JPEG is smaller. PDFs go as they are, and so does
// anything the browser can not draw (the server then says what it accepts).
const MAX_EDGE = 2000
const QUALITY = 0.82

export async function shrinkImage(file) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') return file
  let bitmap
  try {
    // from-image: turned the way the camera held it (EXIF orientation).
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // a transparent PNG gets a white page, not black
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob || (file.type === 'image/png' && blob.size >= file.size)) return file
    const name = (file.name || 'receipt').replace(/\.[^.]*$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close?.()
  }
}

// A small preview of a photo, drawn on a canvas; null when the browser can
// not draw the file. thumbnailOf gives a data: URL to show (the site's CSP
// allows data: images but not blob: ones), thumbnailBlob a JPEG to upload
// (fetching a data: URL is refused too: connect-src 'self').
export async function thumbnailOf(file, edge = 320) {
  return (await drawThumbnail(file, edge))?.toDataURL('image/jpeg', 0.75) ?? null
}

export async function thumbnailBlob(file, edge = 320) {
  const canvas = await drawThumbnail(file, edge)
  return canvas ? new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75)) : null
}

async function drawThumbnail(file, edge) {
  if (!file?.type?.startsWith('image/')) return null
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close?.()
  }
}
