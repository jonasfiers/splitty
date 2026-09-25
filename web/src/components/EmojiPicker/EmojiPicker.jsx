import { useState } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'

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
                    <Picker data={data} onEmojiSelect={e => { onChange(e.native); setOpen(false) }} />
                </div>
            )}
        </div>
    )
}

export default EmojiPicker