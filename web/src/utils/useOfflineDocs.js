import { useEffect, useState } from 'react'
import { listOffline, onOfflineDocsChange } from './offlineDocs.js'
import { listOfflineTrips, onOfflineTripsChange } from './offlineTrips.js'

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

// The trips kept on this device (utils/offlineTrips.js), kept current. null until read.
export function useOfflineTrips() {
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    const read = () => listOfflineTrips().then(l => { if (live) setList(l) })
    read()
    const off = onOfflineTripsChange(read)
    return () => { live = false; off() }
  }, [])
  return list
}

// "2 trips" for the links to the Offline page; '' with nothing kept.
export function keptLabel(trips) {
  const n = trips?.length ?? 0
  return n ? `${n} trip${n !== 1 ? 's' : ''}` : ''
}
