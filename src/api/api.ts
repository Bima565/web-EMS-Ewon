import type { Panel, Tag } from "../types/tag"

const API_BASE = "http://localhost:3000"

const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`fetch ${path} failed (${res.status})`)
  }
  return res.json()
}

export async function getRealtime(): Promise<Tag[]> {
  return fetchJson("/api/realtime")
}

export async function getPanels(): Promise<Panel[]> {
  return fetchJson("/api/panels")
}

export async function getHistory(
  tag: string,
): Promise<Array<{ created: string; tagvalue: number }>> {
  return fetchJson(`/api/history/${tag}`)
}

export type ParamValue = {
  TagId: number
  TagName: string
  Value: number
  AlStatus: number
  AlType: number
  Quality: number
}

export async function getParamValues(): Promise<ParamValue[]> {
  return fetchJson("/api/param-values")
}
