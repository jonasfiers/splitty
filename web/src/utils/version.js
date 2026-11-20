// The build this copy of Splitty came from (vite.config.js buildInfo), for the
// profile page: "20 Nov 2026, 13:40 · 798f2ff". Ends in "+" when it was built
// with uncommitted changes (QA). Tells which version a phone is running after
// a deploy.
export const BUILD = typeof __APP_BUILD__ === 'undefined' ? { commit: null, changed: false, builtAt: null } : __APP_BUILD__

export function versionLabel() {
  const when = BUILD.builtAt
    ? new Date(BUILD.builtAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Unknown build'
  return BUILD.commit ? `${when} · ${BUILD.commit}${BUILD.changed ? '+' : ''}` : when
}
