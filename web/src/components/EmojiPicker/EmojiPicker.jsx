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

function EmojiPicker({ value, onChange, id }) {
    const [open, setOpen] = useState(false)

    return (
        <div className="emoji-picker">
            <button
                type="button"
                id={id}
                tabIndex={0} // in the Tab order like a field (Macs otherwise skip buttons)
                onClick={() => setOpen(s => !s)}
                aria-label={value ? `Icon: ${value}` : 'Pick an icon'}
                className={`emoji-picker-btn${value ? '' : ' empty'}`}
            >
                {value || '+'}
            </button>
            {open && (
                <div className="emoji-picker-pop">
                    <EmojiMartPicker onEmojiSelect={e => { onChange(e.native); setOpen(false) }} />
                </div>
            )}
        </div>
    )
}

export default EmojiPicker
