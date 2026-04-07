import { useEffect, useState } from "react"
import { getParamValues, type ParamValue } from "../api/api"

type HistoryPoint = {
  timestamp: number
  value: number
}

type LiveParamsState = {
  params: ParamValue[]
  history: Record<string, HistoryPoint[]>
  status: "loading" | "idle" | "error"
  lastSync: number | null
}

const FETCH_INTERVAL_MS = 5000
const HISTORY_WINDOW_MS = 60 * 60 * 1000
const STORAGE_KEY = "web-ewon:live-params:v1"

const TRACKED_HISTORY_TAGS = [
  "pm139KWH",
  "pm139AR",
  "pm139P",
  "pm139App",
  "pm139VAN",
  "pm139F",
]

const listeners = new Set<(state: LiveParamsState) => void>()

let pollTimer: number | null = null
let inFlight: Promise<void> | null = null

const buildEmptyHistory = () =>
  TRACKED_HISTORY_TAGS.reduce<Record<string, HistoryPoint[]>>((acc, tag) => {
    acc[tag] = []
    return acc
  }, {})

const readStoredState = (): LiveParamsState => {
  if (typeof window === "undefined") {
    return {
      params: [],
      history: buildEmptyHistory(),
      status: "loading",
      lastSync: null,
    }
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return {
        params: [],
        history: buildEmptyHistory(),
        status: "loading",
        lastSync: null,
      }
    }

    const parsed = JSON.parse(stored) as {
      params?: ParamValue[]
      history?: Record<string, HistoryPoint[]>
      lastSync?: number | null
    }
    const cutoff = Date.now() - HISTORY_WINDOW_MS
    const history = buildEmptyHistory()

    for (const tag of TRACKED_HISTORY_TAGS) {
      history[tag] = (parsed.history?.[tag] ?? []).filter(
        (entry) =>
          entry &&
          Number.isFinite(entry.timestamp) &&
          Number.isFinite(entry.value) &&
          entry.timestamp >= cutoff,
      )
    }

    return {
      params: parsed.params ?? [],
      history,
      status: parsed.params?.length ? "idle" : "loading",
      lastSync: parsed.lastSync ?? null,
    }
  } catch (error) {
    console.error("failed to read live param cache", error)
    return {
      params: [],
      history: buildEmptyHistory(),
      status: "loading",
      lastSync: null,
    }
  }
}

let currentState: LiveParamsState = readStoredState()

const emit = () => {
  listeners.forEach((listener) => listener(currentState))
}

const persistState = () => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        params: currentState.params,
        history: currentState.history,
        lastSync: currentState.lastSync,
      }),
    )
  } catch (error) {
    console.error("failed to persist live param cache", error)
  }
}

const updateState = (updater: (prev: LiveParamsState) => LiveParamsState) => {
  currentState = updater(currentState)
  persistState()
  emit()
}

const mergeHistory = (prevHistory: Record<string, HistoryPoint[]>, params: ParamValue[], now: number) => {
  const nextHistory = buildEmptyHistory()
  const cutoff = now - HISTORY_WINDOW_MS

  for (const tag of TRACKED_HISTORY_TAGS) {
    const existing = (prevHistory[tag] ?? []).filter((entry) => entry.timestamp >= cutoff)
    const match = params.find((param) => param.TagName.toLowerCase() === tag.toLowerCase())

    if (match && Number.isFinite(match.Value)) {
      const previousPoint = existing.at(-1)
      if (!previousPoint || previousPoint.value !== match.Value || now - previousPoint.timestamp >= FETCH_INTERVAL_MS) {
        existing.push({
          timestamp: now,
          value: match.Value,
        })
      }
    }

    nextHistory[tag] = existing
  }

  return nextHistory
}

const refreshLiveParams = async () => {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const params = await getParamValues()
      const now = Date.now()
      updateState((prev) => ({
        params,
        history: mergeHistory(prev.history, params, now),
        status: "idle",
        lastSync: now,
      }))
    } catch (error) {
      console.error("live param polling error", error)
      updateState((prev) => ({
        ...prev,
        status: prev.params.length ? "idle" : "error",
      }))
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

const ensurePolling = () => {
  if (typeof window === "undefined" || pollTimer !== null) return
  void refreshLiveParams()
  pollTimer = window.setInterval(() => {
    void refreshLiveParams()
  }, FETCH_INTERVAL_MS)
}

export const useLiveParams = () => {
  const [state, setState] = useState<LiveParamsState>(currentState)

  useEffect(() => {
    listeners.add(setState)
    ensurePolling()
    setState(currentState)

    return () => {
      listeners.delete(setState)
    }
  }, [])

  return state
}

