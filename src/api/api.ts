export async function getRealtime() {
  const res = await fetch("http://localhost:3000/api/realtime")
  return res.json()
}

export async function getPanels() {
  const res = await fetch("http://localhost:3000/api/panels")
  return res.json()
}

export async function getHistory(tag: string) {
  const res = await fetch(`http://localhost:3000/api/history/${tag}`)
  return res.json()
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
  const res = await fetch("http://localhost:3000/api/param-values")
  if (!res.ok) {
    throw new Error(`fetch /api/param-values failed (${res.status})`)
  }
  return res.json()
}
