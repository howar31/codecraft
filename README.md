# codecraft

[![License](https://img.shields.io/github/license/howar31/codecraft?style=flat-square)](./LICENSE)
[![Powered by ffmpeg.wasm](https://img.shields.io/badge/powered%20by-ffmpeg.wasm-007808?style=flat-square)](https://github.com/ffmpegwasm/ffmpeg.wasm)
[![Deploy](https://img.shields.io/github/actions/workflow/status/howar31/codecraft/deploy.yml?style=flat-square&label=deploy)](https://github.com/howar31/codecraft/actions/workflows/deploy.yml)
[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-yellow?style=flat-square)](https://www.conventionalcommits.org)
[![Stars](https://img.shields.io/github/stars/howar31/codecraft?style=flat-square)](https://github.com/howar31/codecraft/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/howar31/codecraft?style=flat-square)](https://github.com/howar31/codecraft/commits/main)
[![Sponsor on Ko-fi](https://img.shields.io/badge/sponsor-Ko--fi-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/howar31)

瀏覽器內 WebM → GIF 轉檔工具。檔案不離開裝置，全程在本地用 ffmpeg.wasm 處理。

In-browser WebM → GIF converter. Files never leave your device — everything runs locally via ffmpeg.wasm.

**線上版本 / Live:** https://lab.howar31.com/codecraft/

## Features

- 純前端，無後端，無上傳
- 批次處理多個檔案
- 可調 FPS（5–30）與輸出寬度（200–1920）
- 兩種品質模式：
  - **High** — palettegen + paletteuse，色彩較準，檔案較大
  - **Normal** — 直接輸出，速度較快
- 即時下載；超過 5MB 會標記提示
- 完成後直接在頁面預覽 GIF
- 中英雙語 UI

## Stack

Vite + Vanilla JS + `@ffmpeg/ffmpeg` 0.12（single-threaded）

## Development

```bash
npm install
npm run dev        # http://localhost:5173/codecraft/
npm run build      # → dist/
npm run preview
```

## Deployment

push 到 `main` 即觸發 GitHub Actions（`.github/workflows/deploy.yml`），建置後發布到 `gh-pages` 分支。GitHub Pages 設定 source 為 `gh-pages` branch / root。

## Notes

- 首次載入 `ffmpeg-core` 約 30MB（從 unpkg CDN）。
- 使用 single-threaded 變體，不需要 COOP/COEP headers，可直接部署於 GitHub Pages。
- 大檔案建議在桌機處理；行動裝置記憶體較易吃緊。

## License

MIT
