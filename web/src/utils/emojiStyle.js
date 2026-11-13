import openMojiFont from '../assets/fonts/OpenMoji-color.woff2?url'

// Which emoji drawings the app uses: OpenMoji for everyone (the default), so a
// group's icon looks the same on every phone and computer, or each device's
// own. OpenMoji (openmoji.org) is CC BY-SA 4.0, credited on the privacy page.
// It is a font, part of the app (so kept for offline use too): the browser
// draws every emoji with it by itself (index.css, @font-face 'Splitty
// OpenMoji'), and no page needs changing. Per device, like the theme.
const KEY = 'splitty.emojiStyle'
export const EMOJI_STYLES = [
  { value: 'openmoji', label: 'OpenMoji' },
  { value: 'device', label: 'Device' },
]
const DEFAULT = 'openmoji'

export function getEmojiStyle() {
  let v = null
  try { v = localStorage.getItem(KEY) } catch { /* private mode */ }
  return EMOJI_STYLES.some(s => s.value === v) ? v : DEFAULT
}

// OpenMoji-color.woff2 is OpenMoji's COLRv0 build (glyf_colr_0, 17.0.0, 1 MB),
// the one colour format every browser draws, Safari included (2026-11-13). It
// replaced a COLRv1 file plus a separate 5 MB sbix file for Apple's browsers,
// which COLRv1 didn't reach; now one file for all, in everyone's offline copy.
const fontUrl = openMojiFont

// The icon picker (emoji-mart) draws its emoji in a font it calls
// "EmojiMart" first, inside its own shadow DOM: our CSS can't style it, but a
// font registered under that name in the page is used there. So with
// OpenMoji, "EmojiMart" is OpenMoji's font; with Device it isn't registered
// and the picker shows the device's own emoji.
export function applyEmojiStyle(style = getEmojiStyle()) {
  const openmoji = style === 'openmoji'
  if (openmoji) document.documentElement.dataset.emoji = 'openmoji'
  else delete document.documentElement.dataset.emoji

  let el = document.getElementById('emoji-picker-font')
  if (!openmoji) { el?.remove(); return }
  if (!el) { el = document.createElement('style'); el.id = 'emoji-picker-font'; document.head.appendChild(el) }
  el.textContent = `@font-face { font-family: 'EmojiMart'; src: url('${fontUrl}') format('woff2'); font-display: swap; }`
}

export function setEmojiStyle(style) {
  try { localStorage.setItem(KEY, style) } catch { /* just this visit */ }
  applyEmojiStyle(style)
}
