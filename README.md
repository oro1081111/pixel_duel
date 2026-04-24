<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 像素對決 Pixel Duel MVP

「像素對決 (Pixel Duel)」桌遊電子版 MVP。

- **玩法類型**：雙人回合制對戰
- **核心系統**：出牌 → 擲骰 → 判定（攻/防/魔/金）→ 防禦/傷害結算 → 攻擊效果 → 購買補牌
- **實作方式**：單頁前端、以原生 DOM 動態渲染（非 React）

> 本 repo 已精簡為 **Vite + TypeScript + Tailwind CSS**（不含 React/Express/Gemini）。

---

## 技術棧

- Vite（dev server / build）
- TypeScript（程式碼在 `src/main.ts`）
- Tailwind CSS v4（樣式在 `src/index.css`）

---

## 專案結構

```txt
.
├─ index.html            # SPA 入口，載入 /src/main.ts
├─ vite.config.ts        # Vite + Tailwind 設定（無 React plugin）
├─ tsconfig.json         # TS 編譯設定
├─ src/
│  ├─ main.ts            # 遊戲主程式：規則、狀態、render、事件處理
│  └─ index.css          # Tailwind 入口與少量自訂 class
└─ package.json          # scripts / 依賴
```

---

## 本機啟動（開發）

**Prerequisites:** Node.js（建議 LTS）

```bash
npm install
npm run dev
```

Vite 會輸出本機網址（例如 `http://localhost:3000`）。如果 3000/3001 被佔用會自動往後找可用 port。

---

## 建置與預覽

```bash
npm run build
npm run preview
```

---

## 備註：為什麼不能直接點擊 index.html？

此專案入口是 `src/main.ts` 並且使用 Tailwind 編譯流程，因此需要透過 Vite dev server 或 build 後的靜態檔才能在瀏覽器正常運作。
