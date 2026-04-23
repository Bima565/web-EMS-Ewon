const ModbusRTU = require("modbus-serial")

const REALTIME_START_ADDRESS = 3009
const REALTIME_REGISTER_COUNT = 120

const ENERGY_START_ADDRESS = 2705
const ENERGY_REGISTER_COUNT = 2

const METRIC_OFFSETS = {
  current: 3009 - REALTIME_START_ADDRESS,
  voltage: 3035 - REALTIME_START_ADDRESS,
  kw: 3059 - REALTIME_START_ADDRESS,
  kva: 3075 - REALTIME_START_ADDRESS,
  freq: 3109 - REALTIME_START_ADDRESS,
}

const FLOAT_RANGES = {
  current: { min: 0, max: 5000 },
  voltage: { min: 0, max: 1000 },
  kw: { min: -1_000_000, max: 1_000_000 },
  kva: { min: 0, max: 1_000_000 },
  freq: { min: 0, max: 200 },
  kwh: { min: 0, max: 1_000_000_000 },
}

const isFiniteNumber = (value) => Number.isFinite(value)

const decodeFloatNormal = (registers, index) => {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt16BE(registers[index] ?? 0, 0)
  buf.writeUInt16BE(registers[index + 1] ?? 0, 2)
  return buf.readFloatBE(0)
}

const decodeFloatSwapped = (registers, index) => {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt16BE(registers[index + 1] ?? 0, 0)
  buf.writeUInt16BE(registers[index] ?? 0, 2)
  return buf.readFloatBE(0)
}

const inRange = (value, range) =>
  isFiniteNumber(value) && value >= range.min && value <= range.max

const decodeFloatAuto = (registers, index, range) => {
  const normal = decodeFloatNormal(registers, index)
  const swapped = decodeFloatSwapped(registers, index)

  const normalOk = inRange(normal, range)
  const swappedOk = inRange(swapped, range)

  if (normalOk && !swappedOk) return normal
  if (swappedOk && !normalOk) return swapped
  return normal
}

const decodeFloatWithMode = (registers, index, range, wordSwapMode) => {
  if (wordSwapMode === "swap") return decodeFloatSwapped(registers, index)
  if (wordSwapMode === "normal") return decodeFloatNormal(registers, index)
  return decodeFloatAuto(registers, index, range)
}

const normalizeWordSwapMode = (mode) => {
  const normalized = String(mode || "auto").toLowerCase()
  if (normalized === "swap" || normalized === "swapped") return "swap"
  if (normalized === "normal" || normalized === "none") return "normal"
  return "auto"
}

const buildParamValue = (tagId, tagName, value, { quality = 1, alStatus = 0, alType = 0 } = {}) => ({
  TagId: tagId,
  TagName: tagName,
  Value: value,
  AlStatus: alStatus,
  AlType: alType,
  Quality: quality,
})

const clampBadFloat = (value) => (Number.isFinite(value) ? value : 0)

const shouldReconnect = (error) => {
  const code = error?.code
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ETIMEDOUT"
  )
}

class Atc3000ModbusReader {
  constructor({ host, port, slaveId, timeoutMs, wordSwapMode }) {
    this.host = host
    this.port = port
    this.slaveId = slaveId
    this.timeoutMs = timeoutMs
    this.wordSwapMode = normalizeWordSwapMode(wordSwapMode)
    this.client = new ModbusRTU()
    this.connected = false
    this.connecting = null
    this.client.setTimeout?.(timeoutMs)
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) return this.connecting

    this.connecting = (async () => {
      await this.client.connectTCP(this.host, { port: this.port })
      this.client.setID(this.slaveId)
      this.connected = true
    })()

    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  close() {
    try {
      this.client.close?.()
    } catch {
      // ignore close errors
    } finally {
      this.connected = false
      this.connecting = null
    }
  }

  async readHoldingRegisters(address, count) {
    await this.connect()
    try {
      return await this.client.readHoldingRegisters(address, count)
    } catch (error) {
      if (shouldReconnect(error)) {
        this.close()
      }
      throw error
    }
  }

  async readSnapshot() {
    const realtime = await this.readHoldingRegisters(
      REALTIME_START_ADDRESS,
      REALTIME_REGISTER_COUNT,
    )
    const realtimeRegs = realtime?.data ?? realtime?.registers ?? []

    const energy = await this.readHoldingRegisters(
      ENERGY_START_ADDRESS,
      ENERGY_REGISTER_COUNT,
    )
    const energyRegs = energy?.data ?? energy?.registers ?? []

    const voltage = decodeFloatWithMode(
      realtimeRegs,
      METRIC_OFFSETS.voltage,
      FLOAT_RANGES.voltage,
      this.wordSwapMode,
    )
    const current = decodeFloatWithMode(
      realtimeRegs,
      METRIC_OFFSETS.current,
      FLOAT_RANGES.current,
      this.wordSwapMode,
    )
    const kw = decodeFloatWithMode(
      realtimeRegs,
      METRIC_OFFSETS.kw,
      FLOAT_RANGES.kw,
      this.wordSwapMode,
    )
    const kva = decodeFloatWithMode(
      realtimeRegs,
      METRIC_OFFSETS.kva,
      FLOAT_RANGES.kva,
      this.wordSwapMode,
    )
    const freq = decodeFloatWithMode(
      realtimeRegs,
      METRIC_OFFSETS.freq,
      FLOAT_RANGES.freq,
      this.wordSwapMode,
    )
    const kwh = decodeFloatWithMode(
      energyRegs,
      0,
      FLOAT_RANGES.kwh,
      this.wordSwapMode,
    )

    return {
      metrics: {
        voltage: clampBadFloat(voltage),
        current: clampBadFloat(current),
        kw: clampBadFloat(kw),
        kva: clampBadFloat(kva),
        freq: clampBadFloat(freq),
        kwh: clampBadFloat(kwh),
      },
    }
  }
}

const createAtc3000ModbusReader = (config) => new Atc3000ModbusReader(config)

const buildTrackedParamValues = (trackedTags, metrics) => {
  const ids = new Map()
  trackedTags.forEach((tag, index) => {
    ids.set(tag.toLowerCase(), index + 1)
  })

  const tagId = (tag) => ids.get(tag.toLowerCase()) ?? 0

  const values = {
    pm139Status: 1,
    pm139KWH: metrics.kwh,
    pm139AR: metrics.current,
    pm139P: metrics.kw,
    pm139App: metrics.kva,
    pm139VAN: metrics.voltage,
    pm139F: metrics.freq,
  }

  return trackedTags.map((tagName) =>
    buildParamValue(tagId(tagName), tagName, values[tagName] ?? 0, {
      quality: 1,
      alStatus: 0,
      alType: 0,
    }),
  )
}

module.exports = {
  createAtc3000ModbusReader,
  buildTrackedParamValues,
}

