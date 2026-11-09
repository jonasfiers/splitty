// Sections of a page form side by side when the form itself is wide enough
// (720px, measured on the form, not the screen: a folded sidebar gives it
// room sooner); stacked otherwise. The page form counterpart of SheetColumns.
//
// <FormColumns>
//   <FormColumn>…what…</FormColumn>
//   <FormColumn>…when…</FormColumn>
// </FormColumns>
export function FormColumns({ children }) {
  return <div className="form-columns"><div className="form-columns-grid">{children}</div></div>
}
export function FormColumn({ children }) {
  return <div className="form-column">{children}</div>
}
