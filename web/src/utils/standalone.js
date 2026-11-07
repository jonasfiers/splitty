// Whether Splitty runs as the installed app (home screen), not in a browser tab.
// There, a file opened with a plain link fills the app's window with no
// browser bar and no way back, so files open in Splitty's own viewer instead.
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
