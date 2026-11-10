import openMojiFont from '../assets/fonts/OpenMoji-color.woff2?url'
import openMojiApple from '../assets/fonts/OpenMoji-color-sbix.woff2?url'

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

// Apple's browsers (Safari, and every browser on an iPhone or iPad: they are
// all Safari underneath) don't draw this font's colour (COLRv1, SVG): they
// get OpenMoji in Apple's own emoji format (sbix) instead, a separate file
// fetched only by them (5 MB; not in the offline copy: past its 3 MB limit).
const UA = navigator.userAgent
const appleBrowser = /iP(hone|ad|od)/.test(UA)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // an iPad asking for the desktop site
  || (/Safari\//.test(UA) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(UA))
const RANGE = 'U+200D, U+203C, U+2049, U+20E3, U+2139, U+2194-2199, U+21A9-21AA, U+231A-231B, U+2328, U+23CF, U+23E9-23F3, U+23F8-23FA, U+24C2, U+25AA-25AB, U+25B6, U+25C0, U+25FB-25FE, U+2600-27BF, U+2934-2935, U+2B05-2B07, U+2B1B-2B1C, U+2B50, U+2B55, U+3030, U+303D, U+3297, U+3299, U+FE0F, U+1F000-1FAFF, U+E0020-E007F'
const fontUrl = appleBrowser ? openMojiApple : openMojiFont

// The icon picker (emoji-mart) draws its emoji in a font it calls
// "EmojiMart" first, inside its own shadow DOM: our CSS can't style it, but a
// font registered under that name in the page is used there. So with
// OpenMoji, "EmojiMart" is OpenMoji's font; with Device it isn't registered
// and the picker shows the device's own emoji.
export function applyEmojiStyle(style = getEmojiStyle()) {
  const openmoji = style === 'openmoji'
  if (openmoji) document.documentElement.dataset.emoji = appleBrowser ? 'openmoji-apple' : 'openmoji'
  else delete document.documentElement.dataset.emoji

  let el = document.getElementById('emoji-picker-font')
  if (!openmoji) { el?.remove(); return }
  if (!el) { el = document.createElement('style'); el.id = 'emoji-picker-font'; document.head.appendChild(el) }
  el.textContent = `@font-face { font-family: 'EmojiMart'; src: url('${fontUrl}') format('woff2'); font-display: swap; }`
    // Apple's browsers: OpenMoji in their own format, under its own name (the
    // stylesheet's 'Splitty OpenMoji' isn't asked for there, so not fetched).
    + (appleBrowser ? `\n@font-face { font-family: 'Splitty OpenMoji Apple'; src: url('${openMojiApple}') format('woff2'); font-display: swap; unicode-range: ${RANGE}; }` : '')
}

export function setEmojiStyle(style) {
  try { localStorage.setItem(KEY, style) } catch { /* just this visit */ }
  applyEmojiStyle(style)
}
