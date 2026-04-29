# Base Bars (基礎數值條)

這個資料夾放「每個區域上方」顯示的橫向圖片（取代原本的兩個小圓點 `1`）。

## 你需要準備的檔案（共 6 張）

請放在 `public/basebars/`：

- `p0_zone0.png`
- `p0_zone1.png`
- `p0_zone2.png`
- `p1_zone0.png`
- `p1_zone1.png`
- `p1_zone2.png`

其中：
- `p0` = 玩家 0（先手）
- `p1` = 玩家 1（後手）
- `zone0/1/2` = 三個區域（對應骰子 1/2、3/4、5/6）

## 圖片尺寸建議

目前程式預設用 `height: 30px` 顯示（寬度 auto）。
建議使用透明背景 PNG（含 alpha）。

## 你要修改屬性/數值的位置

請編輯：`src/basebars.ts` → `BASE_BARS`

這份表格同時影響：
1) UI 顯示哪張圖
2) 判定階段（骰子帶來的基礎屬性/數值）
