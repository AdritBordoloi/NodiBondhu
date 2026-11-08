import { useEffect, useRef, useState } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { findFeature, focusSummary, isFloodedAt, observedFloodName } from './analysis'
import { errorMessage, getJson, loadLocations, postAlert } from './api'
import { AlertLog } from './components/AlertLog'
import { SwatchTitle } from './components/common'
import { DataSources } from './components/DataSources'
import { FloodReportSource, FloodTimeline } from './components/FloodTimeline'
import { MapLegend } from './components/MapLegend'
import { MapPanel } from './components/MapPanel'
import { RouteMatrix } from './components/RouteMatrix'
import { AlertBlock, LayerToggles, LocationSwitch, RiseControl, ScenarioReadouts } from './components/ScenarioControls'
import { SelectedScenario } from './components/SelectedScenario'
import { SituationReport } from './components/SituationReport'
import { TopBar } from './components/TopBar'
import { EMPTY_DATA, KIND_INFO, KINDS, LOCATE_ZOOM, OUTLINE_COLOR, RISE_PLAY_STEP_MS, ROAD_FLOODED_COLOR, TABS, ZOOM_DURATION_MS } from './constants'
import { captureMap, holdInRegion, moveToRegion, regionCamera, unlockMap } from './map/camera'
import { floodLayerId } from './map/config'
import { addDataLayers, addFloodLayers, applyMapView, showLocationData, whenStyleLoaded } from './map/layers'
import { createMap, openTargetsOnClick } from './map/setup'
import type { Alert, Kind, Location, LocationData, MapMode, ReportInfo, TabId } from './types'

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const markerRef = useRef<Marker | null>(null)
  const locateRef = useRef<() => void>(() => {})
  const cameraLocationRef = useRef<string | null>(null)
  const scrollToTargetRef = useRef(false)
  const [mapTarget, setMapTarget] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('satellite')
  const [mapLocked, setMapLocked] = useState(false)
  const [tab, setTab] = useState<TabId | 'report'>('scenario')
  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const locationIdRef = useRef<string | null>(null)
  const [allData, setAllData] = useState<Record<string, LocationData> | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rise, setRise] = useState(2)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(LOCATE_ZOOM)
  const [visible, setVisible] = useState<Record<Kind, boolean>>({ observed: true, forecast: true, simulated: true })
  const [error, setError] = useState<string | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)
  const [sendingAlert, setSendingAlert] = useState(false)
  const location = locations.find((item) => item.id === locationId)
  const region = (locationId ? allData?.[locationId] : undefined) ?? EMPTY_DATA
  const { layers, settlements, villages, routes, modelCheck, floodReports } = region
  const focusName = location?.focus ?? 'Location'

  useEffect(() => {
    if (!mapContainer.current) return
    const map = createMap(mapContainer.current, () => locateRef.current())
    // 'load' waits for every base map tile, and flood data must not depend on a slow tile server
    map.once('style.load', () => {
      addDataLayers(map)
      openTargetsOnClick(map, {
        floodLayer: () => floodLayerId(locationIdRef.current ?? ''),
        pin: () => markerRef.current?.getElement(),
        open: (target) => {
          setMapTarget(target)
          scrollToTargetRef.current = true
          setTab('data')
        },
      })
      setMapReady(true)
    })
    mapRef.current = map
    return () => {
      setMapReady(false)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      cameraLocationRef.current = null
    }
  }, [])

  // The map has no size while its tab is hidden, so measure again on return
  useEffect(() => {
    if (tab === 'scenario') {
      mapRef.current?.resize()
      // Coming back from a row far down Data Sources should show the map again
      document.querySelector('main.content')?.scrollTo(0, 0)
    }
    // The data tab is only visible once this runs, so its target can be scrolled to now
    if (tab === 'data' && scrollToTargetRef.current) {
      scrollToTargetRef.current = false
      document.querySelector('.map-target')?.scrollIntoView({ block: 'center' })
    }
  }, [tab])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    loadLocations(signal)
      .then(({ locations: locationList, data }) => {
        setLocations(locationList)
        setAllData(data)
        setLocationId(locationList[0]?.id ?? null)
      })
      .catch((reason: unknown) => {
        if (!signal.aborted) setError(errorMessage(reason))
      })
    // The alert log is loaded separately, so a problem with it leaves the flood map working
    getJson<Alert[]>('/api/alerts', signal)
      .then(setAlerts)
      .catch((reason: unknown) => {
        if (!signal.aborted) setAlertError(`Could not load the alert log: ${errorMessage(reason)}`)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !allData) return
    whenStyleLoaded(map, () => addFloodLayers(map, locations, allData))
  }, [locations, allData, mapReady])

  // Runs only when the location changes, so moving the slider never re-sends map data
  useEffect(() => {
    locationIdRef.current = locationId
    const map = mapRef.current
    if (!map || !mapReady || !location) return
    whenStyleLoaded(map, () => showLocationData(map, location.bbox, { layers, settlements, routes, villages }))
  }, [location, locationId, layers, settlements, routes, villages, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    whenStyleLoaded(map, () => applyMapView(map, { visible, mapMode, rise, locations, locationId }))
  }, [locations, locationId, visible, rise, mapMode, mapReady, allData])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !location) return
    markerRef.current ??= new Marker({ color: OUTLINE_COLOR }).setLngLat(location.coordinates).addTo(map)
    markerRef.current.setLngLat(location.coordinates)
    // A hidden map has no size to fit, so it moves when its tab comes back
    if (cameraLocationRef.current === location.id || tab !== 'scenario') return
    // A new region starts at the same view as the locate button
    setZoom(LOCATE_ZOOM)
    if (!moveToRegion(map, location, LOCATE_ZOOM, cameraLocationRef.current !== null)) return
    cameraLocationRef.current = location.id
  }, [location, mapReady, tab])

  // This runs after the flight above has started, so it can wait for it to land
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !location) return
    if (!mapLocked) {
      unlockMap(map)
      return
    }
    // A hidden map has no size to measure
    if (tab !== 'scenario') return
    return holdInRegion(map, location.bbox)
  }, [mapLocked, location, mapReady, tab])

  const scenarios = [...(layers.simulated?.features ?? [])].sort(
    (a, b) => Number(a.properties.rise_m) - Number(b.properties.rise_m),
  )
  const selected = scenarios.find((scenario) => scenario.properties.rise_m === rise)
  const riseValues = scenarios.map((scenario) => Number(scenario.properties.rise_m))
  const riseSteps = riseValues.join(',')

  // Steps through every scenario and starts again. It only runs while the map is on screen
  useEffect(() => {
    if (!playing || tab !== 'scenario' || !riseSteps) return
    const steps = riseSteps.split(',').map(Number)
    const timer = window.setInterval(() => {
      setRise((current) => steps[(steps.indexOf(current) + 1) % steps.length])
    }, RISE_PLAY_STEP_MS)
    return () => window.clearInterval(timer)
  }, [playing, tab, riseSteps])

  const affected = (settlements?.features ?? [])
    .filter((settlement) => isFloodedAt(settlement, rise))
    .map((settlement) => String(settlement.properties.name))
    .sort()
  const focus = focusSummary(settlements, focusName, rise)
  const gauge = findFeature(layers.observed, 'level_m')
  const loading = !allData && !error

  // The view stays inside the study area, as near the rain forecast point as it can
  const applyZoom = (amount: number) => {
    setZoom(amount)
    const map = mapRef.current
    if (!map || !location) return
    const camera = regionCamera(map, location, amount)
    if (camera) map.easeTo({ ...camera, duration: ZOOM_DURATION_MS })
  }

  // The map's own button is made once, so it always reads the current region from here
  useEffect(() => {
    locateRef.current = () => applyZoom(LOCATE_ZOOM)
  })

  const generateReport = async () => {
    const map = mapRef.current
    const mapImage = map ? await captureMap(map) : null
    setReportInfo({
      generatedAt: new Date().toISOString(),
      mapImage,
      layersShown: KINDS.filter((kind) => visible[kind]).map((kind) => KIND_INFO[kind].label),
      mapMode,
    })
    setTab('report')
  }

  const logAlert = async () => {
    setSendingAlert(true)
    setAlertError(null)
    try {
      const alert = await postAlert(locationId, rise)
      setAlerts((current) => [alert, ...current])
    } catch (reason) {
      setAlertError(`Could not log the alert: ${errorMessage(reason)}`)
    } finally {
      setSendingAlert(false)
    }
  }

  return (
    <div className="app">
      <TopBar
        tab={tab}
        onTab={setTab}
        locations={locations}
        locationId={locationId}
        onLocation={setLocationId}
        canReport={tab === 'scenario' && riseValues.length > 0}
        mapReady={mapReady}
        onGenerateReport={generateReport}
      />

      <main className="content">
        {tab !== 'scenario' && (
          <h1>{TABS.find(({ id }) => id === tab)?.label ?? 'Flood Situation Report'}</h1>
        )}
        {/* The header is left out of a printed report, so it needs its own prototype notice */}
        {tab === 'report' && (
          <p className="subtitle">
            {location && `${location.label}. `}Prototype, not for operational use.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            Could not load data: {error}
          </p>
        )}

        <div hidden={tab !== 'scenario'}>
          {scenarios.length === 0 && (
            <p className="empty">{loading ? 'Loading flood data...' : 'No scenarios yet'}</p>
          )}

          <div className="columns">
            <section className="panel">
              <h2 className="section-title">Scenario parameters</h2>
              {locations.length > 0 && (
                <>
                  <span className="field-label">Study region</span>
                  <LocationSwitch locations={locations} selectedId={locationId} onSelect={setLocationId} />
                </>
              )}
              <LayerToggles visible={visible} onToggle={(kind) => setVisible({ ...visible, [kind]: !visible[kind] })} />
              <ScenarioReadouts
                key={locationId}
                focus={focus}
                rise={rise}
                selected={selected}
                gauge={gauge}
                floodReports={floodReports}
                villages={villages}
              />
              {riseValues.length > 0 && (
                <RiseControl
                  rise={rise}
                  riseValues={riseValues}
                  playing={playing}
                  onRise={(value) => {
                    setPlaying(false)
                    setRise(value)
                  }}
                  onTogglePlay={() => setPlaying(!playing)}
                />
              )}
              <AlertBlock
                rise={rise}
                affected={affected}
                sending={sendingAlert}
                error={alertError}
                latestAlert={alerts[0]}
                onLog={logAlert}
                onViewLog={() => setTab('alerts')}
              />
            </section>

            <MapPanel
              containerRef={mapContainer}
              mapLocked={mapLocked}
              onToggleLock={() => setMapLocked(!mapLocked)}
              mapMode={mapMode}
              onMapMode={setMapMode}
              zoom={zoom}
              onZoom={applyZoom}
              legend={
                <MapLegend
                  heat={mapMode === 'heat'}
                  kinds={KINDS.filter((kind) => visible[kind])}
                  rise={rise}
                  focus={focusName}
                  villages={villages}
                  routes={routes}
                  observedFlood={observedFloodName(layers)}
                  hasGauge={gauge?.level_m != null}
                />
              }
            />

            <section className="panel scenario-details">
              <SwatchTitle color={ROAD_FLOODED_COLOR}>Road routes at each river rise</SwatchTitle>
              <RouteMatrix routes={routes} rise={rise} rises={riseValues} settlements={settlements} />
            </section>

            <section className="panel scenario-details">
              <SwatchTitle color={KIND_INFO.observed.color}>Official flood timeline, July 2026</SwatchTitle>
              <FloodTimeline reports={floodReports} radarDate={modelCheck?.image_date} />
              {floodReports?.source && <FloodReportSource reports={floodReports} />}
            </section>

            <SelectedScenario
              {...region}
              rise={rise}
              location={location}
              scenarios={scenarios}
              selected={selected}
              focus={focus}
              affected={affected}
            />
          </div>
        </div>

        <div hidden={tab !== 'alerts'}>
          <AlertLog alerts={alerts} error={alertError} />
        </div>

        <div hidden={tab !== 'data'}>
          <DataSources
            {...region}
            selected={selected}
            hasError={Boolean(error)}
            mapTarget={mapTarget}
            rise={rise}
            regionName={location?.name ?? 'this'}
            onBack={() => setTab('scenario')}
          />
        </div>

        {tab === 'report' && reportInfo && selected && location && (
          <SituationReport
            {...region}
            info={reportInfo}
            location={location}
            rise={rise}
            scenarios={scenarios}
            selected={selected}
            alert={alerts.find((alert) => alert.location === locationId && alert.rise_m === rise)}
            onBack={() => setTab('scenario')}
          />
        )}
      </main>
    </div>
  )
}
