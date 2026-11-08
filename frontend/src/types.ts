import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson'
import type { KINDS, TABS } from './constants'

export type Kind = (typeof KINDS)[number]
export type TabId = (typeof TABS)[number]['id']
export type MapMode = 'default' | 'satellite' | 'heat'

export type Properties = Record<string, string | number | null>
export type Feature = GeoFeature<Geometry, Properties>
export type Layer = FeatureCollection<Geometry, Properties>
export type Layers = Record<Kind, Layer | null>

export type Alert = {
  id: number
  created_at: string
  location?: string
  location_name?: string
  rise_m: number
  settlements: string[]
  channel: string
}

export type Location = {
  id: string
  name: string
  label: string
  focus: string
  coordinates: [number, number]
  bbox: [number, number, number, number]
}

export type LandUse = {
  source?: string
  quality?: string
  land_use_year?: string
  squares_checked?: number
  squares_without_data?: number
  scenarios?: {
    rise_m: number
    flooded_area_km2: number
    land_types: { name: string; flooded_km2: number; share: number }[]
  }[]
}

export type ModelCheckResult = {
  source?: string
  quality?: string
  event?: string
  image_date?: string
  compared_with?: string
  observed_km2?: number
  radar_coverage_share?: number
  best_rise_m?: number
  scenarios?: {
    rise_m: number
    model_km2: number
    observed_inside_model_share: number
    model_seen_by_radar_share: number
    overlap_score: number
  }[]
}

export type FloodReportDay = {
  date: string
  report_generated: string | null
  checked: boolean
  villages: number | null
  people: number | null
  crop_hectares: number | null
  river_status: 'highest' | 'danger' | 'not_listed'
}

export type ReportField = 'villages' | 'people' | 'crop_hectares'

export type FloodReports = {
  source?: string
  source_url?: string
  quality?: string
  area?: string
  gauge?: string
  days?: FloodReportDay[]
}

// Everything loaded for one study region. Panels get it whole, so a new dataset is added in one place
export type LocationData = {
  layers: Layers
  settlements: Layer | null
  villages: Layer | null
  landUse: LandUse | null
  routes: Layer | null
  modelCheck: ModelCheckResult | null
  floodReports: FloodReports | null
}

export type ReportInfo = {
  generatedAt: string
  mapImage: string | null
  layersShown: string[]
  mapMode: MapMode
}

export type ChartBar = { label: string; value: number; shown: string; highlight: boolean; labelled?: boolean }

export type AiResult = { status: string; text?: string; model?: string; message?: string; plain?: number }
