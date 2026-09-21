# XPORTS Pitch AI — 前端

React + Vite + TypeScript + Tailwind v4。設計已套用到帳號流程、選手資料庫、報告頁與比較頁。

## 執行

```bash
npm install
npm run dev          # http://localhost:5173
```

需要 Node 20+。`npm run build` 打包，`npm run preview` 預覽打包結果。

假資料要重新產生時：

```bash
python3 scripts/generate_fixtures.py
```

---

## 1. 路由架構

依流程圖轉錄，**檢測 live 依指示暫不實作**，尚未配路由。

| 路徑 | 頁面 | 對應流程圖 |
|---|---|---|
| `/login` | 登入 | 帳號系統介面 › 登入 |
| `/register` | 註冊（教練／選手分流） | 帳號系統介面 › 註冊 |
| `/register/complete` | 完成註冊 | — |
| `/` | 首頁 | 首頁 |
| `/players` | 選手資料庫 | 選手資料庫 |
| `/players/:playerId` | 選手日誌（基本資料＋訓練紀錄） | 選手清單 › 選手日誌 |
| `/sessions/:sessionId` | 場次投球列表 | 訓練清單 |
| `/report/:pitchId?tab=` | 選手報告 | 選手報告 |
| `/compare` | 投球比較記錄（兩筆都要選） | 比較 |
| `/compare?a=<pitchId>` | 投球比較記錄（自動帶入記錄 1） | 報告頁 › 模組三 |
| `/compare/result?a=&b=` | 雙欄比較結果 | 比較介面 |
| `/account` `/settings` `/team` | 三個設定頁（佔位） | — |

左下角有開發用的教練／選手身分切換，資料範圍會跟著變。

## 2. 資料層

### 兩種資料形態

| | 說明 | 前端型別 | MySQL |
|---|---|---|---|
| **線性資料** | 每個 frame 一個值，畫成曲線 | `SeriesData` | `pitch_series`（JSON 欄位存陣列） |
| **單一值** | 每球一個值，畫成指標卡 | `ScalarData` | `pitch_scalars` |

目前每一項都有一筆假數值：**24 條線性曲線 × 120 frames**，**16 個單一值**。

線性資料分組：動作階段分序 4、手臂角度 4、手臂角速度 4、軀幹屈曲角度 2、
軀幹旋轉角度 3、軀幹屈曲角速度 2、軀幹旋轉角速度 3、膝屈曲 1、膝伸展角速度 1。

單一值分組：`summary` 9（Sequencing、Efficiency、Arm Path、Hand Speed、Torque、
Deception、Stride Length、Hip-shoulder Sep、External Rot.）、`joint_angle` 4
（Pelvis／Torso／Elbow／Shoulder）、`release` 3（出手點高度／側偏／延伸）。

數值一律用工程單位（deg、deg/sec、Mph、Nm、ms、cm），不是 0–1 正規化值。
每條曲線自帶 `yMin`/`yMax`，所以不同球的同一條曲線軸距固定、可以直接並排比對。
`samples` 允許 `null`，代表姿態辨識沒解出來的斷點，畫圖時會斷線而不是內插。

### 串接後端

`src/api/dataSource.ts` 有兩個實作，介面相同：

- `fixtureSource` — 讀 `public/api/*.json`（現在用這個）
- `httpSource(baseUrl)` — 打真正的 REST API

切換只要設環境變數，元件一行都不用改：

```bash
VITE_API_BASE=https://api.example.com npm run dev
```

REST 端點與 `server/schema.sql` 的資料表一一對應。JSON fixture 的欄位跟
`src/api/types.ts` 完全一致，後端照著實作就能無縫替換。

### MySQL

`server/schema.sql` 是完整 DDL。曲線存 JSON 欄位而不是每 frame 一列——
一球 24 條曲線正規化後會是約 2,900 列，而曲線永遠整條讀取、不會單獨查某一 frame，
JSON 又小又快。如果之後需要跨 frame 查詢（例如「找出肘力矩峰值超過 X 的所有球」），
把峰值存成 scalar，不要把曲線正規化。

`measurement_defs` 存標籤、單位、顏色、說明文字，由 API join 上去，
不要在每一列 pitch 資料重複。

## 3. 檢測項目：2D／3D／影片

`src/components/viewer/PitchViewer.tsx` 一個元件三種模式，切換時播放位置保留。

- **影片** — 真的 `<video>`，可播放、可 seek，另有「疊骨架」開關把 2D 骨架疊在影片上
- **2D 骨架** — SVG，讀 pose 的 `joints2d`
- **3D 骨架** — 讀 `joints3d`，支援轉動視角／放大縮小／拖動（滾輪也可縮放）

3D 沒有引入 three.js。整個場景是 15 個點、14 條線，自己做投影比架 WebGL scene graph
更小更快。之後如果要加球路、地面、多機位，再換成 react-three-fiber，props 不用動。

`public/media/sample-pitch.mp4` 是測試用影片，每一格都印了 frame 編號且全部是
keyframe，可以直接肉眼確認影片、骨架、曲線游標三者同步。

### FP / MER / BR

事件以 frame index 存在 `pitch_events`，payload 裡是 `events: { fps, fp, mer, br }`。

- 時間軸上有標記，可點擊跳到該格
- 每張曲線圖都畫垂直事件線（BR 用虛線）
- 單一值可以綁定事件（`atEvent`），例如 Hand Speed 取 BR 當下、Torque 取 MER 當下

`src/playback/PlaybackContext.tsx` 是唯一時間來源。影片、2D、3D、24 張圖表、
時間軸游標全部訂閱同一個 `frame`，沒有元件自己記時間。時鐘用 `requestAnimationFrame`
而非 `<video>` 的 timeupdate，因為骨架模式沒有影片可驅動；`<video>` 掛載時
透過 `registerVideo` 註冊，由 context 反過來 seek 它。

## 待辦

- [ ] 比較頁的連續相位對齊（目前只做到事件層級對齊，見下）
- [ ] 骨架校正與輔助線工具
- [ ] 年齡與成長狀況模組
- [ ] 帳號／基本設定／隊伍設定的實際內容
- [ ] 真正的登入與權限
- [ ] 檢測 live（本階段暫緩）

## 待確認

1. **曲線顏色兩份規格不一致。** 流程圖指定紅／藍／綠／橘並綁定具名生理量，
   Figma 稿用洋紅／藍／紅／綠且只標 data1–4。程式碼照流程圖。
2. **軀幹分頁會有 10 張圖。** 目前照 Figma 手臂分頁的做法一條一張堆疊，
   要不要改成疊圖或分組摺疊？
3. **Release 那三個單一值是我補的**，流程圖沒列，如果不需要就從
   `SCALAR_DEFS` 移除。


## 比較頁的雙時鐘

兩球長度不同，所以不能共用一個 frame index。`DualPlaybackProvider` 同時持有兩個
時鐘，每一欄用 `<PlaybackScope slot="a">` 包起來，該欄的影片、骨架、時間軸、圖表
就都讀同一個時鐘。中間那排傳輸控制透過 `both()` 同時對兩個時鐘下指令。

FP／MER／BR 三個按鈕會讓兩邊各自跳到自己的事件 frame，這是**事件層級的相位對齊**。
事件與事件之間的連續時間扭曲（time warping）還沒做，是清單上的下一項。

## 3D 操作

左鍵拖曳轉動視角、右鍵拖曳平移、滾輪縮放。畫布上的右鍵選單已停用，右鍵拖曳才能用。
觸控裝置沒有右鍵，目前單指拖曳是轉動視角；如果平板是重要情境，需要另外加手勢。

## 素材

`public/media/` 兩個檔案都是佔位用的，換成真素材時直接覆蓋即可：

- `login-hero.jpg` — 登入頁左側大圖，程式化生成的球場色塊，不是照片
- `sample-pitch.mp4` — 測試影片，每格印有 frame 編號且全為 keyframe，
  方便肉眼確認影片與骨架、曲線游標同步
