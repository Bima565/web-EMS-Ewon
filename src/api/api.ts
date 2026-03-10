export async function getRealtime() {
  const res = await fetch("http://localhost:3000/api/realtime")
  return res.json()
}

export async function getPanels() {
  const res = await fetch("http://localhost:3000/api/panels")
  return res.json()
}

export async function getHistory(tag:string) {
  const res = await fetch(`http://localhost:3000/api/history/${tag}`)
  return res.json()
}