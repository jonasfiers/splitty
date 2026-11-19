import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Sheet from '../Sheet/Sheet.jsx'
import Icon from '../Icon/Icon.jsx'
import { ICON_SETS, iconLabel } from '../../utils/icons.js'
import SearchField from '../SearchField/SearchField.jsx'

// An icon for a category, group or trip: a square button showing the current
// one, opening a sheet with a search and the icons in a grid by section.
// The value is what is stored: a line icon's name ("train-front") for a
// category, a country ("country:TW") for a trip, an emoji ("🌈") for a group;
// or '' for none.
//
// kind:      'category' | 'trip' | 'group' (utils/icons.js ICON_SETS)
// clearable: the sheet offers a "none" button (onChange(''))
const TEXT = {
  category: { title: 'Icon', search: 'Search, e.g. food, train, shop', none: 'No icon' },
  trip: { title: 'Country', search: 'Search a country, e.g. Japan', none: 'No flag (the group’s emoji)' },
  group: { title: 'Emoji', search: 'Search, e.g. beach, pizza, Japan', none: 'No emoji' },
}
export default function IconPicker({ value, onChange, id, kind = 'category', clearable = false }) {
  const text = TEXT[kind]
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
  const sections = ICON_SETS[kind]
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
        aria-label={value ? `${text.title}: ${iconLabel(value)}` : `Pick ${kind === 'category' ? 'an icon' : kind === 'trip' ? 'a country' : 'an emoji'}`}
        className={`icon-picker-btn${value ? '' : ' empty'}`}
      >
        {value ? <Icon name={value} fallback="circle-question-mark" /> : '+'}
      </button>
      {open && createPortal(
        <Sheet title={text.title} onClose={close} className="picker-sheet picker-sheet-tall icon-picker-sheet">
          <SearchField
            className="picker-search"
            placeholder={text.search}
            aria-label="Search icons"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus={window.matchMedia?.('(pointer: fine)').matches}
          />
          <div className="icon-picker-body">
            {clearable && !words.length && (
              <button type="button" className={`icon-picker-none${value ? '' : ' selected'}`} onClick={() => choose('')}>
                {text.none}
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
