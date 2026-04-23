const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { Service } = require("node-windows")

const ROOT_DIR = path.resolve(__dirname, "..")
const SERVICE_SCRIPT = path.join(__dirname, "server.js")
const SERVICE_NAME = "Web Ewon API"
const SERVICE_DESCRIPTION =
  "Background service untuk API, polling ATC 3000 (Modbus), dan logging Web Ewon."
const SERVICE_LOG_DIR = path.join(ROOT_DIR, "logs", "service")
const VALID_COMMANDS = new Set([
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
  "status",
])

fs.mkdirSync(SERVICE_LOG_DIR, { recursive: true })

const envOrDefault = (name, fallback) => {
  const value = process.env[name]
  if (value == null || value === "") return String(fallback)
  return String(value)
}

const log = (message) => {
  console.log(`[service-manager] ${message}`)
}

const fail = (message, error) => {
  console.error(`[service-manager] ${message}`)
  if (error) {
    console.error(error)
  }
  process.exit(1)
}

const exitSoon = (code = 0) => {
  setTimeout(() => {
    process.exit(code)
  }, 250)
}

const wait = (ms, callback) => {
  setTimeout(callback, ms)
}

const runSc = (...args) => {
  const result = spawnSync("sc.exe", args, {
    encoding: "utf8",
    windowsHide: true,
  })

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    error: result.error ?? null,
  }
}

const createService = () =>
  new Service({
    name: SERVICE_NAME,
    description: SERVICE_DESCRIPTION,
    script: SERVICE_SCRIPT,
    execPath: process.execPath,
    workingDirectory: ROOT_DIR,
    logpath: SERVICE_LOG_DIR,
    logmode: "rotate",
    env: [
      { name: "DATA_SOURCE", value: envOrDefault("DATA_SOURCE", "ATC3000") },
      {
        name: "ATC3000_HOST",
        value: envOrDefault(
          "ATC3000_HOST",
          envOrDefault("ATC_MODBUS_HOST", "192.168.100.99"),
        ),
      },
      { name: "ATC3000_PORT", value: envOrDefault("ATC3000_PORT", envOrDefault("ATC_MODBUS_PORT", "502")) },
      {
        name: "ATC3000_SLAVE_ID",
        value: envOrDefault("ATC3000_SLAVE_ID", envOrDefault("ATC_MODBUS_SLAVE_ID", "2")),
      },
      {
        name: "ATC3000_TIMEOUT_MS",
        value: envOrDefault("ATC3000_TIMEOUT_MS", envOrDefault("MODBUS_TIMEOUT_MS", "4000")),
      },
      {
        name: "ATC3000_WORD_SWAP",
        value: envOrDefault("ATC3000_WORD_SWAP", envOrDefault("ATC_MODBUS_WORD_SWAP", "auto")),
      },
      { name: "PARAM_POLL_INTERVAL_MS", value: envOrDefault("PARAM_POLL_INTERVAL_MS", "5000") },
    ],
    wait: 5,
    grow: 0.25,
    maxRestarts: 10,
    stopparentfirst: true,
    stoptimeout: 30,
  })

const service = createService()
service.logOnAs = null
const serviceKeyName = service._exe

const getServiceState = () => {
  const result = runSc("query", serviceKeyName)
  if (!result.ok) {
    return {
      installed: false,
      state: "NOT_INSTALLED",
      details: result.stderr || result.stdout,
    }
  }

  const match = result.stdout.match(/STATE\s*:\s*\d+\s+([A-Z_]+)/)
  return {
    installed: true,
    state: match?.[1] ?? "UNKNOWN",
    details: result.stdout.trim(),
  }
}

const ensureAdmin = () => {
  const result = spawnSync("net", ["session"], {
    encoding: "utf8",
    windowsHide: true,
  })

  if (result.status !== 0) {
    fail("jalankan command ini dari terminal Administrator.")
  }
}

const configureNativeRecovery = () => {
  const configStart = runSc("config", serviceKeyName, "start=", "auto")
  if (!configStart.ok) {
    log(
      `gagal mengubah startup type ke auto: ${configStart.stderr || configStart.stdout}`.trim(),
    )
  }

  const recovery = runSc(
    "failure",
    serviceKeyName,
    "reset=",
    "86400",
    "actions=",
    "restart/5000/restart/15000/restart/30000",
  )
  if (!recovery.ok) {
    log(
      `gagal mengatur recovery service: ${recovery.stderr || recovery.stdout}`.trim(),
    )
  }

  const failureFlag = runSc("failureflag", serviceKeyName, "1")
  if (!failureFlag.ok) {
    log(
      `gagal mengaktifkan failure flag: ${failureFlag.stderr || failureFlag.stdout}`.trim(),
    )
  }
}

const printStatus = () => {
  const state = getServiceState()
  log(`service name: ${SERVICE_NAME}`)
  log(`service key : ${serviceKeyName}`)
  log(`script      : ${SERVICE_SCRIPT}`)
  log(`daemon dir  : ${service.root}`)
  log(`log dir     : ${SERVICE_LOG_DIR}`)
  log(`installed   : ${state.installed ? "ya" : "tidak"}`)
  log(`state       : ${state.state}`)
  if (state.installed && state.details) {
    console.log(state.details)
  }
}

const waitForInstalled = (attempts, callback) => {
  const state = getServiceState()
  if (state.installed) {
    callback(true)
    return
  }
  if (attempts <= 0) {
    callback(false)
    return
  }

  wait(1000, () => {
    waitForInstalled(attempts - 1, callback)
  })
}

const waitForState = (expectedState, attempts, callback) => {
  const state = getServiceState()
  if (state.installed && state.state === expectedState) {
    callback(true, state)
    return
  }
  if (attempts <= 0) {
    callback(false, state)
    return
  }

  wait(1000, () => {
    waitForState(expectedState, attempts - 1, callback)
  })
}

const usage = () => {
  console.log(
    "Pemakaian: node server/service-manager.js <install|uninstall|start|stop|restart|status>",
  )
}

const command = String(process.argv[2] || "").toLowerCase()
if (!VALID_COMMANDS.has(command)) {
  usage()
  process.exit(command ? 1 : 0)
}

const originalConsoleLog = console.log
console.log = (...args) => {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === "object" &&
    args[0].loc === "winsw.js ~line 77"
  ) {
    return
  }

  originalConsoleLog(...args)
}

service.on("error", (error) => {
  fail("operasi service gagal.", error)
})

if (command === "status") {
  printStatus()
  process.exit(0)
}

ensureAdmin()

if (command === "install") {
  service.on("alreadyinstalled", () => {
    log("service sudah terpasang.")
    printStatus()
    exitSoon(0)
  })

  service.on("invalidinstallation", () => {
    fail(
      "instalasi service terdeteksi tidak valid. Jalankan uninstall lalu install ulang.",
    )
  })

  service.on("install", () => {
    log("service berhasil di-install.")
    waitForInstalled(10, (installed) => {
      if (!installed) {
        fail("service belum terdaftar penuh di Windows setelah install.")
      }

      configureNativeRecovery()
      log("menjalankan service...")
      service.start()
    })
  })

  service.on("start", () => {
    waitForState("RUNNING", 10, (running, state) => {
      if (!running) {
        fail(`service gagal mencapai state RUNNING. State terakhir: ${state.state}`)
      }

      log("service berhasil dijalankan.")
      printStatus()
      exitSoon(0)
    })
  })

  log("memasang Windows Service...")
  service.install()
}

if (command === "uninstall") {
  service.on("alreadyuninstalled", () => {
    log("service belum terpasang.")
    exitSoon(0)
  })

  service.on("uninstall", () => {
    log("service berhasil dihapus.")
    exitSoon(0)
  })

  log("menghapus Windows Service...")
  service.uninstall()
}

if (command === "start") {
  const state = getServiceState()
  if (!state.installed) {
    fail("service belum terpasang. Jalankan install terlebih dahulu.")
  }
  if (state.state === "RUNNING") {
    log("service sudah berjalan.")
    process.exit(0)
  }

  service.on("start", () => {
    waitForState("RUNNING", 10, (running, state) => {
      if (!running) {
        fail(`service gagal mencapai state RUNNING. State terakhir: ${state.state}`)
      }

      log("service berhasil dijalankan.")
      exitSoon(0)
    })
  })

  log("menjalankan service...")
  service.start()
}

if (command === "stop") {
  const state = getServiceState()
  if (!state.installed) {
    fail("service belum terpasang.")
  }
  if (state.state === "STOPPED") {
    log("service sudah berhenti.")
    process.exit(0)
  }

  service.on("stop", () => {
    log("service berhasil dihentikan.")
    exitSoon(0)
  })

  service.on("alreadystopped", () => {
    log("service sudah berhenti.")
    exitSoon(0)
  })

  log("menghentikan service...")
  service.stop()
}

if (command === "restart") {
  const state = getServiceState()
  if (!state.installed) {
    fail("service belum terpasang.")
  }

  service.on("start", () => {
    waitForState("RUNNING", 10, (running, state) => {
      if (!running) {
        fail(`service gagal mencapai state RUNNING. State terakhir: ${state.state}`)
      }

      log("service berhasil dijalankan ulang.")
      exitSoon(0)
    })
  })

  service.on("alreadystopped", () => {
    log("service sedang berhenti, menjalankan ulang...")
    service.start()
  })

  log("me-restart service...")
  service.restart()
}
