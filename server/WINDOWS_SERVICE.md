# Windows Service

Server API ini sekarang bisa dipasang sebagai Windows Service memakai `node-windows`.

## Syarat

- Jalankan terminal sebagai `Administrator`
- Node.js harus terpasang

## Lokasi penting

- Script server: `server/server.js`
- Script manajemen service: `server/service-manager.js`
- Log wrapper service: `logs/service`
- File daemon service: `server/daemon`

## Perintah

Jalankan dari root project:

```powershell
npm --prefix server run service:install
npm --prefix server run service:status
npm --prefix server run service:stop
npm --prefix server run service:start
npm --prefix server run service:restart
npm --prefix server run service:uninstall
```

Atau dari folder `server`:

```powershell
npm run service:install
```

## Nama service

- Display name: `Web Ewon API`
- Service key: `webewonapi.exe`

## Catatan

- Saat install, service diatur `auto start` dan recovery restart otomatis jika gagal.
- Monitoring detail tetap bisa dilihat dari `GET /api/health`.
- Jika sebelumnya Anda masih menjalankan `Run server API.bat`, hentikan dulu supaya tidak bentrok port `3000`.
