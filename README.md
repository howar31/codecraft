# Codec Craft

[![License](https://img.shields.io/github/license/howar31/codecraft?style=flat-square)](./LICENSE)
[![Powered by ffmpeg.wasm](https://img.shields.io/badge/powered%20by-ffmpeg.wasm-007808?style=flat-square)](https://github.com/ffmpegwasm/ffmpeg.wasm)
[![Deploy](https://img.shields.io/github/actions/workflow/status/howar31/codecraft/deploy.yml?style=flat-square&label=deploy)](https://github.com/howar31/codecraft/actions/workflows/deploy.yml)
[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-yellow?style=flat-square)](https://www.conventionalcommits.org)
[![Stars](https://img.shields.io/github/stars/howar31/codecraft?style=flat-square)](https://github.com/howar31/codecraft/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/howar31/codecraft?style=flat-square)](https://github.com/howar31/codecraft/commits/main)
[![Sponsor on Ko-fi](https://img.shields.io/badge/sponsor-Ko--fi-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/howar31)

> 名稱 **Codec Craft**，slug `codecraft`（中間兩個 c 合併）。

瀏覽器內動態影像格式互轉工具：WebM ⇄ GIF、GIF ⇄ APNG。檔案不離開裝置，全程在本地用 ffmpeg.wasm 處理。

In-browser bidirectional animated-image converter: WebM ⇄ GIF, GIF ⇄ APNG. Files never leave your device — everything runs locally via ffmpeg.wasm.

![Codec Craft demo](./docs/hero.gif)

**線上版本 / Live:** https://lab.howar31.com/codecraft/

## Features

- 純前端，無後端，無上傳
- 支援格式對：WebM → GIF、GIF → WebM / APNG、APNG → GIF（`.png` 會 byte-sniff 判定是否為 APNG）
- 批次轉檔，同一張 GIF 可一次輸出多種格式（per-card chips 或全域 default）
- FPS 預設「依來源」可選 10 ~ 50；寬度預設「原寬」可選 240 ~ 1920
- 無限循環播放可切換（GIF `-loop 0/-1`、APNG `-plays 0/1`、WebM `<video loop>`）
- 兩種輸出品質：
  - **High** — GIF: palettegen + paletteuse；WebM: VP8 CRF 10；APNG: `-pred mixed -compression_level 9`
  - **Normal** — 較快、檔案較小（GIF 直接輸出；WebM CRF 24）
- 完成後就地預覽 GIF / APNG（`<img>`）與 WebM（`<video>`），並提供下載連結
- 超過 5 MB 顯示警告（hover 看詳細）
- 重複檔案偵測（同名同大小提示但不阻擋）
- 拖檔可從整個瀏覽器視窗任何位置丟入
- 雙欄佈局，左側控制項在寬螢幕 sticky 跟著捲動
- i18n（中文 / English）切換、偏好寫入 localStorage

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
