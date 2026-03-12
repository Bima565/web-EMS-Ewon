import { useEffect, useMemo, useState } from "react"
import { getRealtime, getPanels } from "../api/api"
import DashboardChart from "../components/DashboardChart"
import ParamChart from "../components/ParamChart"
import type { Panel, Tag } from "../types/tag"

const trafficMetrics = [
  { label: "Voltase", code: "VAB", unit: "V", color: "text-emerald-300" },
  { label: "Ampere", code: "AR", unit: "A", color: "text-cyan-300" },
  { label: "Daya", code: "P", unit: "kW", color: "text-indigo-300" },
  { label: "Frekuensi", code: "F", unit: "Hz", color: "text-amber-300" },
]

export default function Dashboard() {
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

  const lastSync = useMemo(
    () =>
      new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [tags.length],
  )

  const summaryStats = [
    { label: "Panel aktif", value: panels.length.toString() },
    { label: "Titik telemetri", value: tags.length.toString() },
    { label: "Pembaruan terakhir", value: lastSync },
  ]

  const trafficData = trafficMetrics.map((metric) => {
    const match = tags.filter((t) => t.tagname.includes(metric.code)).pop()
    return {
      ...metric,
      value:
        match?.tagvalue != null
          ? match.tagvalue.toFixed?.(2) ?? String(match.tagvalue)
          : "—",
    }
  })

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-6xl space-y-10 px-6 py-10">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.5em] text-slate-400">Operasi Energi</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">Dasbor EMS EWON</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Tampilkan data terbaru dari setiap panel yang dimonitor dengan umpan balik langsung
            mengenai tegangan, arus, daya, dan frekuensi di lantai pabrik.
          </p>
        </div>

      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-900/70 to-slate-900/40 p-6 shadow-[0_30px_60px_rgba(15,23,42,0.55)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Tren</p>
                <h2 className="text-xl font-semibold text-white">Aliran daya</h2>
              </div>
              <span className="text-xs uppercase tracking-[0.4em] text-slate-400">Langsung</span>
            </div>
            <div className="mt-6">
              <DashboardChart />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-white/80 p-6 shadow-2xl shadow-slate-900/40 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Ringkasan</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">Kesehatan situs</h3>
              <div className="mt-6 grid gap-5 text-slate-500 sm:grid-cols-3">
                {summaryStats.map((stat) => (
                  <div key={stat.label} className="space-y-1">
                    <div className="text-sm font-medium text-slate-400">{stat.label}</div>
                    <div className="text-lg font-semibold text-slate-900">{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-900/70 p-6 text-slate-200 shadow-lg">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Alur</p>
              <p className="mt-3 text-sm text-slate-300">
                Sinkronisasi data berjalan setiap dua detik untuk menjaga telemetri tetap selaras
                dengan output terkini. Panel tidak aktif diberi bayangan untuk menghemat bandwidth.
              </p>
            </div>

            <div className="rounded-[28px] border border-solid border-white/5 bg-slate-900/80 p-6 shadow-[0_20px_40px_rgba(2,6,23,0.6)]">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Trafik energi</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {trafficData.map((metric) => (
                  <div
                    key={metric.code}
                    className="flex flex-col rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <span className={`text-xs uppercase tracking-[0.3em] ${metric.color}`}>
                      {metric.label}
                    </span>
                    <span className="text-2xl font-semibold text-white">
                      {metric.value} <span className="text-xs font-medium text-slate-400">{metric.unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div>
          <ParamChart />
        </div>
      </section>
    </main>
  )
}
