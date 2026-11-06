import L from 'leaflet'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'

// The base map under both maps (trip map, route finder): a vector map drawn
// in the browser by MapLibre, from Splitty's own copy of the Protomaps planet
// (one PMTiles file the browser reads in pieces with range requests), with
// labels in English where OpenStreetMap has them and a real dark style.
// Leaflet stays in charge of everything on top (pins, arcs, arrows, pop-ups),
// so only the base layer differs from the raster map.
//
// Served by nginx under /maps/ (docs/deploying.md, "Vector base map"):
//   /maps/planet.pmtiles          the tiles (a link to the current build)
//   /maps/assets/fonts/...        label glyphs (protomaps/basemaps-assets)
//   /maps/assets/sprites/v4/...   map icons
// If any of it is missing, or the browser has no WebGL, the map falls back to
// the OpenStreetMap raster tiles through the tile proxy (api/tileProxy.js).

const PLANET = '/maps/planet.pmtiles'
const ATTRIBUTION = '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// The worker is a separate file from Splitty's own origin, not a blob: URL,
// so the Content Security Policy's worker-src 'self' allows it.
maplibregl.setWorkerUrl(workerUrl)
let protocolAdded = false
function addProtocol() {
  if (protocolAdded) return
  maplibregl.addProtocol('pmtiles', new Protocol().tile)
  protocolAdded = true
}

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark'

function style(dark) {
  const origin = window.location.origin
  return {
    version: 8,
    glyphs: `${origin}/maps/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/maps/assets/sprites/v4/${dark ? 'dark' : 'light'}`,
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${origin}${PLANET}`, attribution: ATTRIBUTION },
    },
    layers: layers('protomaps', namedFlavor(dark ? 'dark' : 'light'), { lang: 'en' }),
  }
}

// Checked once: each check creates a WebGL context, and browsers allow only
// a handful at a time (MapLibre needs one per map).
let webgl = null
function webglWorks() {
  if (webgl !== null) return webgl
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    webgl = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

function addRaster(map) {
  map.getContainer().classList.add('basemap-raster')
  return L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
}

// Adds the base map to a Leaflet map. Returns a cleanup function.
export function addBasemap(map) {
  if (!webglWorks()) {
    addRaster(map)
    return () => {}
  }
  addProtocol()
  let dark = isDark()
  let fellBack = false
  let removed = false
  let watch = null
  // Leaflet calls the layer's onAdd (which creates the MapLibre map) only
  // once the map has a view, so everything that needs the MapLibre map waits
  // for the layer's 'add'. The attribution comes and goes with the layer.
  // The raster layer limited Leaflet's zoom to 19; this layer does not (only
  // tile layers do), so the map gets the same limit. The planet goes to 15
  // and MapLibre stretches it; beyond 19 there is nothing more to see.
  map.setMaxZoom(19)
  const layer = maplibreGL({ style: style(dark), attribution: ATTRIBUTION, interactive: false })
  layer.once('add', () => {
    const gl = layer.getMaplibreMap()

    // The planet file not there (e.g. a server without the /maps/ mount yet)
    // or unreadable: swap to the raster tiles, once. Only while the source
    // has never loaded: after that, an error is one tile that failed (a
    // network hiccup), which MapLibre retries on the next move, and missing
    // fonts or icons only lose labels or symbols, not the map.
    let sourceLoaded = false
    gl.on('sourcedata', e => { if (e.sourceId === 'protomaps' && (e.sourceDataType === 'metadata' || e.isSourceLoaded)) sourceLoaded = true })
    gl.on('error', e => {
      if (fellBack || sourceLoaded || e?.tile) return
      if (e?.sourceId !== 'protomaps' && !/pmtiles/i.test(e?.error?.message || '')) return
      fellBack = true
      console.warn('Vector map unavailable, using raster tiles:', e?.error?.message || e)
      // Not inside MapLibre's own event: removing the layer destroys its map.
      setTimeout(() => {
        if (removed) return
        map.removeLayer(layer)
        addRaster(map)
      })
    })

    // Light/dark follows the app's theme without rebuilding the map.
    watch = new MutationObserver(() => {
      if (fellBack || isDark() === dark) return
      dark = isDark()
      gl.setStyle(style(dark))
    })
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  })
  layer.addTo(map)
  return () => { removed = true; watch?.disconnect() }
}
