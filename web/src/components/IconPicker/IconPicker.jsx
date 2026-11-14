import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Sheet from '../Sheet/Sheet.jsx'
import Icon from '../Icon/Icon.jsx'
import { ICON_SECTIONS, iconLabel } from '../../utils/icons.js'

// An icon for a category, group or trip: a square button showing the current
// one, opening a sheet with a search and the icons in a grid by section.
// The value is the icon's name ("train-front"), or '' for none.
//
// clearable: the sheet offers "No icon" (onChange(''))
export default function IconPicker({ value, onChange, id, clearable = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const buttonRef = useRef(null)

  const close = () => {
    setOpen(false)
    setQuery('')
    buttonRef.current?.focus()
  }
  const choose = name => {
    if (name !== value) onChange(name)
    close()
  }

  // Every word typed must start a word of the icon's name, keywords or section.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (icon, section) => {
    const hay = `${icon.label} ${icon.keywords} ${section}`.toLowerCase().split(/[\s&,()-]+/)
    return words.every(w => hay.some(h => h.startsWith(w)))
  }
  const sections = ICON_SECTIONS
    .map(s => ({ ...s, icons: words.length ? s.icons.filter(i => matches(i, s.section)) : s.icons }))
    .filter(s => s.icons.length)

  return (
    <div className="icon-picker">
      <button
        ref={buttonRef}
        type="button"
        id={id}
        tabIndex={0} // in the Tab order like a field (Macs otherwise skip buttons)
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={value ? `Icon: ${iconLabel(value)}` : 'Pick an icon'}
        className={`icon-picker-btn${value ? '' : ' empty'}`}
      >
        {value ? <Icon name={value} fallback="circle-question-mark" /> : '+'}
      </button>
      {open && createPortal(
        <Sheet title="Icon" onClose={close} className="picker-sheet picker-sheet-tall icon-picker-sheet">
          <input
            className="picker-search"
            type="search"
            placeholder="Search, e.g. food, train, Japan"
            aria-label="Search icons"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus={window.matchMedia?.('(pointer: fine)').matches}
          />
          <div className="icon-picker-body">
            {clearable && !words.length && (
              <button type="button" className={`icon-picker-none${value ? '' : ' selected'}`} onClick={() => choose('')}>
                No icon
              </button>
            )}
            {sections.map(s => (
              <section key={s.section} aria-label={s.section}>
                <h3 className="picker-section">{s.section}</h3>
                <div className="icon-picker-grid">
                  {s.icons.map(i => (
                    <button
                      key={i.name}
                      type="button"
                      className={`icon-picker-cell${i.name === value ? ' selected' : ''}`}
                      onClick={() => choose(i.name)}
                      aria-label={i.label}
                      aria-pressed={i.name === value}
                      title={i.label}
                    >
                      <Icon name={i.name} size={22} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!sections.length && <p className="list-hint picker-none">Nothing matches “{query.trim()}”.</p>}
          </div>
        </Sheet>,
        document.body,
      )}
    </div>
  )
}
