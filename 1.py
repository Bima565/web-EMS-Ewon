from pymodbus.client import ModbusTcpClient
import struct
import time

ATC_IP = "192.168.100.99"
PORT = 502
SLAVE_ID = 2

client = ModbusTcpClient(ATC_IP, port=PORT)

def decode_float(regs, i):
    # normal BIG endian
    raw = struct.pack('>HH', regs[i], regs[i+1])
    return struct.unpack('>f', raw)[0]

def read_realtime():
    response = client.read_holding_registers(
        address=3009,
        count=120,
        device_id=SLAVE_ID
    )

    if response.isError():
        print("❌ Error realtime:", response)
        return None

    r = response.registers

    try:
        data = {
            "voltage": decode_float(r, 3035 - 3009),
            "current": decode_float(r, 3009 - 3009),
            "kw": decode_float(r, 3059 - 3009),
            "kva": decode_float(r, 3075 - 3009),
            "freq": decode_float(r, 3109 - 3009),
        }
        return data
    except:
        # 🔁 fallback kalau endian kebalik
        def decode_swap(i):
            raw = struct.pack('>HH', r[i+1], r[i])
            return struct.unpack('>f', raw)[0]

        return {
            "voltage": decode_swap(3035 - 3009),
            "current": decode_swap(3009 - 3009),
            "kw": decode_swap(3059 - 3009),
            "kva": decode_swap(3075 - 3009),
            "freq": decode_swap(3109 - 3009),
        }

def read_energy():
    response = client.read_holding_registers(
        address=2705,
        count=2,
        device_id=SLAVE_ID
    )

    if response.isError():
        print("❌ Error kWh:", response)
        return None

    r = response.registers

    try:
        raw = struct.pack('>HH', r[0], r[1])
        return struct.unpack('>f', raw)[0]
    except:
        raw = struct.pack('>HH', r[1], r[0])
        return struct.unpack('>f', raw)[0]


def main():
    if not client.connect():
        print("❌ Gagal konek")
        return

    print("✅ Connected ke ATC 3000")

    try:
        realtime = read_realtime()
        kwh = read_energy()

        if realtime:
            print(f"⚡ Voltage : {realtime['voltage']:.2f} V")
            print(f"🔌 Current : {realtime['current']:.2f} A")
            print(f"⚙️ Power   : {realtime['kw']:.2f} kW")
            print(f"📦 kVA     : {realtime['kva']:.2f} kVA")
            print(f"📡 Freq    : {realtime['freq']:.2f} Hz")

        if kwh is not None:
            print(f"🔋 Energy  : {kwh:.2f} kWh")

    except Exception as e:
        print("❌ Exception:", e)

    finally:
        client.close()


while True:
    main()
    time.sleep(5)