import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom"
import Dashboard from "./pages/Dashboard.tsx"
import Panels from "./pages/Panels.tsx"

const navItems = [
  { to: "/dashboard", label: "Dasbor", description: "Ringkasan real-time" },
  { to: "/tagdesc", label: "Tagdesc", description: "Detil panel" },
]

function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <aside className="w-72 border-r border-white/10 bg-slate-950/90 px-6 py-10 text-sm">
          <p className="text-xs uppercase tracking-[0.5em] text-slate-500">Menu</p>
          <h1 className="mt-2 text-xl font-semibold text-white">EWON EMS</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.35em] text-slate-400">
            Monitoring
          </p>
          <nav className="mt-8 space-y-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "flex w-full flex-col rounded-2xl border px-4 py-3 transition",
                    isActive
                      ? "border-cyan-400/60 bg-gradient-to-r from-cyan-500/20 to-blue-500/10 text-white shadow-[0_10px_30px_rgba(14,165,233,0.25)]"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30",
                  ].join(" ")
                }
              >
                <span className="text-lg font-semibold">{item.label}</span>
                <span className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-400">
                  {item.description}
                </span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tagdesc" element={<Panels />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
