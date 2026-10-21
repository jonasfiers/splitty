import { useEffect, useRef, useState } from 'react'
import { Picker } from 'emoji-mart'
import data from '@emoji-mart/data'

// emoji-mart's own React wrapper (@emoji-mart/react) stopped at React 18, so the
// web-component Picker is mounted here directly, the same way that wrapper did.
function EmojiMartPicker({ onEmojiSelect }) {
    const ref = useRef(null)
    const onSelect = useRef(onEmojiSelect)
    onSelect.current = onEmojiSelect

    useEffect(() => {
        const host = ref.current
        new Picker({ data, ref, onEmojiSelect: e => onSelect.current(e) })
        return () => { host.replaceChildren() }
    }, [])

    return <div ref={ref} />
}

function EmojiPicker({ value, onChange }) {
    const [open, setOpen] = useState(false)

    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen(s => !s)}
                aria-label={value ? `Icon: ${value}` : 'Pick an icon'}
                style={{ fontSize: 22, width: 44, height: 44, border: `1px ${value ? 'solid' : 'dashed'} var(--border)`, borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text-2)' }}
            >
                {value || '+'}
            </button>
            {open && (
                <div style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0 }}>
                    <EmojiMartPicker onEmojiSelect={e => { onChange(e.native); setOpen(false) }} />
                </div>
            )}
        </div>
    )
}

export default EmojiPicker
