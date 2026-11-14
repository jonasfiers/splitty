import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import Sheet from '../Sheet/Sheet.jsx'
import { asIcon } from '../Icon/Icon.jsx'

// A choice from a list, in the app's own sheet instead of the browser's
// <select> (which looks different, and dated, on every phone).
//
// <Picker title="Paid by" value={id} onChange={setId} options={[
//   { value: 'u1', label: 'Me', icon: <Avatar…/> },
//   { value: 'u2', label: 'Anna', meta: 'anna@…', indent: true },
// ]} />
//
// variant:     'field' (looks like an input, for forms) or 'chip' (filter rows)
// placeholder: shown while nothing is chosen
// title:       the sheet's title (defaults to the placeholder)
// required:    the form will not submit while nothing is chosen
// id:          for a <Field> label; goes on the button
// Options can also have: meta (a grey line), short (shown in the button
// instead of the label), section (a heading above the first option of each
// section), keywords (extra text the search matches), indent, disabled,
// key (when one value is listed twice), hideWhenSearching.
// A search field appears for lists longer than SEARCH_FROM.
const SEARCH_FROM = 9

export default function Picker({
  value, onChange, options, variant = 'field', placeholder = 'Select…', title, required = false,
  disabled = false, id, className = '', 'aria-label': ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const buttonRef = useRef(null)
  const selected = options.find(o => o.value === value)

  const close = () => {
    setOpen(false)
    setQuery('')
    buttonRef.current?.focus()
  }
  const choose = v => {
    if (v !== value) onChange(v)
    close()
  }

  const q = query.trim().toLowerCase()
  const shown = q ? options.filter(o => !o.hideWhenSearching && `${o.label} ${o.meta || ''} ${o.keywords || ''} ${o.section || ''}`.toLowerCase().includes(q)) : options

  const chevron = <svg className="picker-chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>

  return (
    <span className={`picker picker-${variant} ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        // In the Tab order like the <select> it replaces (Safari and Firefox on a
        // Mac otherwise skip buttons: macOS's keyboard-navigation setting).
        tabIndex={0}
        className={variant === 'chip' ? `chip picker-chip-btn${value ? ' active' : ''}` : 'picker-field-btn'}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && id ? `${id}-label ${id}` : undefined}
      >
        {selected?.icon != null && <span className="picker-icon" aria-hidden="true">{asIcon(selected.icon)}</span>}
        <span className={`picker-text${selected ? '' : ' picker-placeholder'}`}>{selected ? (selected.short ?? selected.label) : placeholder}</span>
        {chevron}
      </button>
      {/* For the form's own "please fill in" check: invisible, under the button. */}
      {required && (
        <input className="picker-required" tabIndex={-1} aria-hidden="true" required value={value ?? ''} onChange={() => {}}
          onInvalid={e => { e.preventDefault(); setOpen(true) }} />
      )}

      {open && createPortal(
        <Sheet title={title || placeholder} onClose={close}
          // With a search: tall from the start, so it doesn't shrink as the list
          // filters and slide its search under the keyboard.
          className={`picker-sheet${options.length >= SEARCH_FROM ? ' picker-sheet-tall' : ''}`}>
          {options.length >= SEARCH_FROM && (
            <input
              className="picker-search"
              type="search"
              placeholder="Search"
              aria-label="Search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus={window.matchMedia?.('(pointer: fine)').matches}
            />
          )}
          <div className="list picker-list" role="listbox" aria-label={title || placeholder}>
            {shown.map((o, i) => [
              o.section && o.section !== shown[i - 1]?.section && (
                <div key={`s-${o.section}`} className="picker-section" role="presentation">{o.section}</div>
              ),
              <button
                key={o.key ?? o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`list-row list-row-link picker-option${o.indent ? ' picker-option-indent' : ''}`}
                onClick={() => choose(o.value)}
                disabled={o.disabled}
              >
                {o.icon != null && <span className="picker-option-icon" aria-hidden="true">{asIcon(o.icon)}</span>}
                <span className="list-row-text">
                  <span className="list-row-title">{o.label}</span>
                  {o.meta && <span className="list-row-meta">{o.meta}</span>}
                </span>
                {o.value === value && (
                  <svg className="picker-check" viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12 10 17 19 7" /></svg>
                )}
              </button>,
            ])}
            {shown.length === 0 && <p className="list-hint picker-none">Nothing matches “{query.trim()}”.</p>}
          </div>
        </Sheet>,
        document.body,
      )}
    </span>
  )
}
