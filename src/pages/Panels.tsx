import { useEffect, useState } from "react"
import { getRealtime, getPanels } from "../api/api"
import TagdescRow from "../components/TagdescRow"
import type { Panel, Tag } from "../types/tag"

export default function Panels() {
  const [tags, setTags] = useState<Tag[]>([])
  const [panels, setPanels] = useState<Panel[]>([])

  useEffect(() => {
    const load = () => {
      getRealtime().then(setTags)
      getPanels().then(setPanels)
    }

    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])

  if (!panels.length) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <p className="text-lg text-slate-400">Memuat data panel...</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.5em] text-slate-400">Tagdesc overview</p>
          <h1 className="text-3xl font-semibold text-white">Detil semua panel</h1>
          <p className="text-sm text-slate-300">
            Setiap kartu menampilkan grafik intraday beserta metrik utama sehingga Anda bisa menelusuri
            performa panel secara visual.
          </p>
        </div>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {panels.map((panel) => (
            <TagdescRow key={panel.id} panel={panel} tags={tags} />
          ))}
        </section>
      </section>
    </main>
  )
}
