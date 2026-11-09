import { Children, cloneElement, isValidElement, useId } from 'react'

// A form field: label, control and hint, wired together.
//
// <Field label="Email" hint="We never share it.">
//   <input type="email" … />
// </Field>
//
// The label points at the control (tapping it focuses the field, screen
// readers read it out with the field), and the hint is the field's
// description. The control is the one element inside; it gets the id
// (custom controls pass `id` on to their input or button).
//
// optional:  true for "optional" after the label, or a string of your own
// aside:     something at the end of the label row (a link, a button)
// id:        set it (and the same id on the control) when the control sits
//            inside a wrapper; the children are then left as they are
// group:     several controls (chips, a list of checkboxes) rather than one:
//            a labelled group instead of a <label>
// className, style: on the outer .form-group
export default function Field({ label, optional, hint, aside, group = false, id: idProp, className = '', style, children }) {
  const auto = useId()
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null
  const id = idProp ?? only?.props.id ?? auto
  const hintId = hint ? `${id}-hint` : undefined
  const labelId = `${id}-label`

  const text = <>
    {label}
    {optional && <> <span className="label-optional">{optional === true ? 'optional' : optional}</span></>}
  </>
  const labelEl = group
    ? <div className="field-label" id={labelId}>{text}</div>
    : <label htmlFor={id} id={labelId}>{text}</label>
  const control = !group && only && idProp == null
    ? cloneElement(only, { id, ...(hintId && { 'aria-describedby': hintId }) })
    : children

  return (
    <div
      className={`form-group ${className}`.trim()}
      style={style}
      {...(group && { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': hintId })}
    >
      {aside ? <div className="field-label-row">{labelEl}{aside}</div> : labelEl}
      {control}
      {hint && <p className="form-hint" id={hintId}>{hint}</p>}
    </div>
  )
}
