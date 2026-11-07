import { useEffect, useState } from 'react'
import { listOffline, onOfflineDocsChange } from './offlineDocs.js'

// The documents kept on this device (utils/offlineDocs.js), kept current.
// null until read.
export function useOfflineDocs() {
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    const read = () => listOffline().then(l => { if (live) setList(l) })
    read()
    const off = onOfflineDocsChange(read)
    return () => { live = false; off() }
  }, [])
  return list
}
