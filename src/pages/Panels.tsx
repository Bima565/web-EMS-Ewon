import { useEffect, useMemo, useState } from "react"
import { getRealtime, getPanels } from "../api/api"
import TagdescRow from "../components/TagdescRow"
import type { Panel, Tag } from "../types/tag"
import "./style-Panels.css"

const groupDefinitions = [
  { marker: "F1", description: "Listrik utama" },
  { marker: "F2", description: "Pendingin & HVAC" },
]

const f1PanelTagNames = new Set(
  [
    "pm132",
    "pm133",
    "pm134",
    "pm135",
    "pm136",
    "pm138",
    "pm139",
    "pm140",
    "pm151",
    "pm152",
    "pm153",
    "pm154",
    "pm175",
    "pm176",
    "pm177",
    "pm178",
    "pm179",
    "pm180",
    "pm181",
    "pm182",
    "pm183",
    "pm184",
    "pm185",
  ].map((value) => value.toLowerCase()),
)

const categorizeByTagname = (tagname: string) => {
  const normalized = tagname.toLowerCase()
  if (f1PanelTagNames.has(normalized)) return "F1"
  if (normalized.includes("f1")) return "F1"
  if (normalized.includes("f2")) return "F2"
  return "F2"
}

export default function Panels() {
  const [tags, setTags] = useState<Tag[]>([])
  const [panels, setPanels] = useState<Panel[]>([])

  const groupedPanels = useMemo(
    () =>
      groupDefinitions.map((group) => ({
        ...group,
        panels: panels.filter((panel) => categorizeByTagname(panel.tagname) === group.marker),
      })),
    [panels],
  )
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const selectedGroupPanels = groupedPanels.find((group) => group.marker === selectedGroup)
  const selectedGroupDescription = selectedGroupPanels?.description
  const selectedGroupDisplay = selectedGroup
    ? `${selectedGroup} - ${selectedGroupDescription ?? "Area"}`
    : "Belum memilih area"
  const summaryStats = [
    { label: "Panel dimuat", value: panels.length.toString() },
    { label: "Titik telemetri", value: tags.length.toString() },
    {
      label: "Area terpilih",
      value: selectedGroup
        ? `${selectedGroupDisplay} (${selectedGroupPanels?.panels.length ?? 0} panel)`
        : selectedGroupDisplay,
    },
  ]

  useEffect(() => {
    const load = () => {
      getRealtime().then(setTags)
      getPanels().then(setPanels)
    }

    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])

  return (
    <main className="panels-page">
      <section className="panels-wrapper">
        <div className="panels-gradient" />
        <div className="panels-content">
          <div className="panels-hero">
            <p className="panels-hero-meta">Tagdesc overview</p>
            <h1 className="panels-hero-title">Detil semua panel</h1>
            <p className="panels-hero-subtitle">
              Setiap kartu menampilkan grafik intraday beserta metrik utama sehingga Anda bisa menelusuri
              performa panel secara visual.
            </p>
          </div>

          <div className="panels-group-card">
            <div className="panels-group-grid">
              {groupedPanels.map((group) => {
                const isActive = selectedGroup === group.marker
                return (
                  <button
                    key={group.marker}
                    type="button"
                    onClick={() => setSelectedGroup(group.marker)}
                    className={`panels-group-button ${isActive ? "panels-group-button--active" : ""}`}
                  >
                    <div>
                      <p className="panels-group-marker">{group.marker}</p>
                      <p className="panels-group-description">{group.description}</p>
                    </div>
                    <span className="panels-group-count">{group.panels.length} panel</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="panels-summary-grid">
            {summaryStats.map((stat) => (
              <div key={stat.label} className="panels-summary-card">
                <p className="panels-summary-card-label">{stat.label}</p>
                <p className="panels-summary-card-value">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="panels-detail-shell">
            {!selectedGroupPanels ? (
              <div className="panels-empty-state">
                Pilih area (F1 atau F2) untuk melihat daftar power meter yang sesuai.
              </div>
            ) : (
              <section className="panels-detail-card">
                <div className="panels-detail-header">
                  <div>
                    <p className="panels-detail-marker">{selectedGroupPanels.marker}</p>
                    <h2 className="panels-detail-title">{selectedGroupPanels.description}</h2>
                  </div>
                  <span className="panels-detail-count">
                    {selectedGroupPanels.panels.length} panel
                  </span>
                </div>
                <p className="panels-detail-text">
                  Data telemetri terkini ditarik terus-menerus untuk area ini sehingga Anda bisa mengawasi tren
                  daya dan kesehatan perangkat dengan margin luas.
                </p>

                {selectedGroupPanels.panels.length ? (
                  <div className="panels-detail-grid">
                    {selectedGroupPanels.panels.map((panel) => (
                      <TagdescRow key={panel.id} panel={panel} tags={tags} />
                    ))}
                  </div>
                ) : (
                  <div className="panels-no-panel">
                    Tidak ada panel untuk {selectedGroupPanels.marker} saat ini.
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
