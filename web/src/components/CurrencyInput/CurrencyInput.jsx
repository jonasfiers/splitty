import { useRef } from 'react'
import { NumericFormat} from 'react-number-format'
import './CurrencyInput.css'

function CurrencyInput({ iso = 'EUR', value, onChange, required, autoFocus, id, ...aria }) {
    const inputRef = useRef(null)
    const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: iso })
    const symbol = formatter.formatToParts(0).find(p => p.type === 'currency')?.value
    const decimals = formatter.resolvedOptions().maximumFractionDigits

    const validate = floatValue => {
        if (!required || !inputRef.current) return
        inputRef.current.setCustomValidity(
            !floatValue || floatValue <= 0 ? 'Amount must be greater than 0' : ''
        )
    }

    return (
        <NumericFormat
            className='currency-input'
            prefix={symbol ? `${symbol} ` : ''}
            value={value / 10 ** decimals}
            onValueChange={({ floatValue }) => {
                validate(floatValue)
                onChange(Math.round((floatValue ?? 0) * 10 ** decimals))
            }}
            decimalScale={decimals}
            fixedDecimalScale
            allowNegative={false}
            allowedDecimalSeparators={['.', ',']}
            inputMode="decimal"
            onFocus={e => {
                const target = e.target
                setTimeout(() => {
                    const sep = target.value.search(/[.,]/)
                    const pos = sep !== -1 ? sep : target.value.length
                    target.setSelectionRange(pos, pos)
                }, 0)
            }}
            required={required}
            autoFocus={autoFocus}
            id={id}
            {...aria}
            getInputRef={el => { inputRef.current = el }}
        />
    )
}

export default CurrencyInput