// A search field with the magnifier in front (2026-11-19): every search in
// Splitty (group expenses, place picker, pickers, icon picker, linking an
// expense) looks the same. The × that clears it is the browser's own, restyled
// in index.css (input[type="search"]::-webkit-search-cancel-button).
// Other props go to the <input>; `className` goes on the wrapper.
export default function SearchField({ className = '', ...input }) {
  return (
    <label className={`search-field ${className}`.trim()}>
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input type="search" autoComplete="off" {...input} />
    </label>
  )
}
