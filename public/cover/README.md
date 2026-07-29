# Cover image folder

首頁的遊戲封面圖放在這裡：

```
public/cover/pixel_duel_cover.jpg
```

## 替換方式

直接覆蓋同名檔案即可，不需要改程式碼。
若要改檔名，請同步修改 `src/main.ts` 的 `COVER_IMG_URL`。

## 小提醒

- 建議使用正方形（1:1）圖片，首頁是以正方形比例排版的。
- 路徑必須維持「相對路徑」（`cover/...`），因為本專案在 GitHub Pages 使用 Vite `base: '/pixel_duel/'`，
  絕對路徑（`/cover/...`）會繞過 base 而 404。
