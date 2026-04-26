# Cards PNG folder

把卡牌圖片放在這裡：

```
public/cards/
```

## 命名規則（固定）

檔名格式：

```
pixel_duel-01.png
pixel_duel-02.png
...
```

## 對應方式（你自己決定）

每張卡牌在 `src/cards.ts` 都有一個 `imgNo` 欄位。

- `imgNo = 1` 會對應到 `pixel_duel-01.png`
- `imgNo = 28` 會對應到 `pixel_duel-28.png`

目前「卡牌一覽」會依 `imgNo` 由小到大排序顯示，並在每張卡下方顯示對應的 PNG 檔名，方便你對照放圖。

## 小提醒

- 建議圖片比例固定（例如 2:3），避免縮放後留白比例不一致。
- 之後如果要把遊戲內卡牌也改成 PNG，一樣可以沿用這個命名規則。
