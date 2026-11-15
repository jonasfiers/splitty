// Which emoji drawings the app uses: OpenMoji for everyone (the default), so a
// group's emoji looks the same on every phone and computer, or each device's
// own. OpenMoji (openmoji.org) is CC BY-SA 4.0, credited on the privacy page.
// It is a font, part of the app (so kept for offline use too): the browser
// draws every emoji with it by itself (index.css, @font-face 'Splitty
// OpenMoji'), and no page needs changing. Per device, like the theme.
//
// OpenMoji-color.woff2 is OpenMoji's COLRv0 build (glyf_colr_0, 17.0.0, 1 MB),
// the one colour format every browser draws, Safari included (2026-11-13).
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

export function applyEmojiStyle(style = getEmojiStyle()) {
  if (style === 'openmoji') document.documentElement.dataset.emoji = 'openmoji'
  else delete document.documentElement.dataset.emoji
}

export function setEmojiStyle(style) {
  try { localStorage.setItem(KEY, style) } catch { /* just this visit */ }
  applyEmojiStyle(style)
}
