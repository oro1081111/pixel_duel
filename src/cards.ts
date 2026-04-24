export type AttrType = 'attack' | 'defense' | 'magic' | 'gold';

export type CardAttr = {
  type: AttrType;
  value: number;
};

/**
 * 可編輯卡牌資料表：修改這裡後，重新整理即可生效。
 *
 * - id：純資料表內辨識用（可選）
 * - effectId：必須對應遊戲邏輯中使用的效果 id（例如 barrier/charge...）
 * - left/right：左右屬性的「類型 + 數值」
 */
export type CardDef = {
  id: string;
  effectId: string;
  name: string;
  desc: string;
  left: CardAttr;
  right: CardAttr;
};

// 這裡提供一組「固定但可改」的預設值。
// 你可以直接在此檔案逐張修改 left/right 的 type/value。
export const CARD_DEFS: CardDef[] = [
  {
    id: 'barrier',
    effectId: 'barrier',
    name: '魔力屏障',
    desc: '可消耗 3 點魔力一次，額外增加 3 點防禦 [防禦階段]',
    left: { type: 'gold', value: 1 },
    right: { type: 'magic', value: 2 },
  },
  {
    id: 'charge',
    effectId: 'charge',
    name: '魔力貫穿',
    desc: '可消耗 2 點魔力一次，使一次攻擊 +3 [攻擊階段]',
    left: { type: 'magic', value: 1 },
    right: { type: 'defense', value: 1 },
  },
  {
    id: 'amplify',
    effectId: 'amplify',
    name: '紅蓮飛刃',
    desc: '每次攻擊額外 +1 攻擊力 [攻擊階段]',
    left: { type: 'gold', value: 1 },
    right: { type: 'attack', value: 2 },
  },
  {
    id: 'magic_bullet',
    effectId: 'magic_bullet',
    name: '魔彈散射',
    desc: '每消耗 1 點魔力，額外增加一次強度為 2 的攻擊 [攻擊階段]',
    left: { type: 'magic', value: 1 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'ambush',
    effectId: 'ambush',
    name: '飛刀突襲',
    desc: '額外製造 1 點無法防禦且無法被強化的傷害 [攻擊階段][被動觸發]',
    left: { type: 'attack', value: 1 },
    right: { type: 'gold', value: 1 },
  },
  {
    id: 'fate',
    effectId: 'fate',
    name: '命運之石',
    desc: '可選擇任意數量的已投擲骰子，重新投擲一次 [擲骰階段][判定階段]',
    left: { type: 'attack', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'dodge',
    effectId: 'dodge',
    name: '幻影疾閃',
    desc: '消耗 3 點魔力，無視任意一次攻擊 [防禦階段]',
    left: { type: 'magic', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'diversion',
    effectId: 'diversion',
    name: '魔力導流',
    desc: '若獲得總魔力 <= 2，則提升至 5 點魔力 [判定階段][被動觸發]',
    left: { type: 'attack', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'reproduction',
    effectId: 'reproduction',
    name: '魔力再現',
    desc: '可消耗 2 點魔力一次，使一次攻擊視為兩次 [攻擊階段]',
    left: { type: 'magic', value: 1 },
    right: { type: 'attack', value: 2 },
  },
  {
    id: 'gale',
    effectId: 'gale',
    name: '疾風突襲',
    desc: '該區每有 1 顆骰子，額外造成 1 點無法防禦的傷害[判定階段][被動觸發]',
    left: { type: 'gold', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'shadow',
    effectId: 'shadow',
    name: '暗影突襲',
    desc: '若該區無任何骰子，額外造成 3 點無法防禦的傷害 [判定階段][被動觸發]',
    left: { type: 'attack', value: 1 },
    right: { type: 'gold', value: 1 },
  },
  {
    id: 'flare',
    effectId: 'flare',
    name: '雙重閃光',
    desc: '可消耗 3 點魔力一次，使一次攻擊數值翻倍 [攻擊階段]',
    left: { type: 'attack', value: 1 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'thrust',
    effectId: 'thrust',
    name: '翡翠突刺',
    desc: '使當前所有強度為 1 或 2 的普通攻擊強度翻倍 [攻擊階段]',
    left: { type: 'attack', value: 1 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'shield',
    effectId: 'shield',
    name: '充能護盾',
    desc: '每消耗 2 點魔力，額外增加 1 點防禦 [防禦階段]',
    left: { type: 'magic', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'backfire',
    effectId: 'backfire',
    name: '反噬之盾',
    desc: '若成功防禦對手所有攻擊，額外造成 2 點無法防禦的傷害 [防禦階段][被動觸發]',
    left: { type: 'defense', value: 1 },
    right: { type: 'defense', value: 1 },
  },
  {
    id: 'flame_shield',
    effectId: 'flame_shield',
    name: '炎盾衝擊',
    desc: '該區域每 1 點防禦，必視為 2 點攻擊 [判定階段][被動觸發]',
    left: { type: 'attack', value: 1 },
    right: { type: 'defense', value: 1 },
  },
  {
    id: 'brilliance',
    effectId: 'brilliance',
    name: '光輝之箭',
    desc: '該區骰子數量至少 3 顆時，該區攻擊力額外 +7 [判定階段][被動觸發]',
    left: { type: 'attack', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'forest',
    effectId: 'forest',
    name: '森林之箭',
    desc: '可消耗 3 點魔力一次，使所有攻擊合併為一次攻擊 [攻擊階段]',
    left: { type: 'attack', value: 1 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'frost',
    effectId: 'frost',
    name: '冰霜之箭',
    desc: '可捨棄一顆已投擲骰子，並產生強度 1~3 的額外攻擊 [擲骰階段]',
    left: { type: 'attack', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'holy_light',
    effectId: 'holy_light',
    name: '復甦聖光',
    desc: '每消耗 2 點魔力，回復 1 點生命 [任意階段]',
    left: { type: 'attack', value: 2 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'soul_snatch',
    effectId: 'soul_snatch',
    name: '奪魂禁咒',
    desc: '每消耗 3 點魔力，吸收對手 1 點生命 [任意階段]',
    left: { type: 'gold', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'contract',
    effectId: 'contract',
    name: '不滅契約',
    desc: '生命 >= 4 受到致命傷時，回復至 1 點生命 [傷害階段][被動觸發]',
    left: { type: 'gold', value: 1 },
    right: { type: 'defense', value: 1 },
  },
  {
    id: 'surge',
    effectId: 'surge',
    name: '魔能湧動',
    desc: '該區獲得的魔力數值翻倍 [判定階段][被動觸發]',
    left: { type: 'gold', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'breakthrough',
    effectId: 'breakthrough',
    name: '臨界突破',
    desc: '當生命 <= 3 時，擲骰獲得的所有數值翻倍 [任意階段][被動觸發]',
    left: { type: 'defense', value: 1 },
    right: { type: 'attack', value: 1 },
  },
  {
    id: 'mirage',
    effectId: 'mirage',
    name: '幻境空間',
    desc: '雙方不得使用消耗魔力之效果；防禦 +1，該區基本攻擊 +2 [任意階段][被動觸發]',
    left: { type: 'attack', value: 2 },
    right: { type: 'gold', value: 1 },
  },
  {
    id: 'lucky',
    effectId: 'lucky',
    name: '幸運之石',
    desc: '擲骰數 +1，隨後須移除一顆骰子 [擲骰階段][被動觸發]',
    left: { type: 'defense', value: 1 },
    right: { type: 'gold', value: 1 },
  },
  {
    id: 'magic_luck',
    effectId: 'magic_luck',
    name: '魔運之石',
    desc: '可消耗 2 點魔力一次，額外再投擲 1 顆骰子 [判定階段]',
    left: { type: 'defense', value: 1 },
    right: { type: 'magic', value: 1 },
  },
  {
    id: 'illusion',
    effectId: 'illusion',
    name: '幻象幽影',
    desc: '可消耗 1 點魔力一次，複製對手任一技能 [判定階段]',
    left: { type: 'magic', value: 2 },
    right: { type: 'gold', value: 1 },
  },
];

/**
 * 給 UI 用的效果清單（卡牌效果一覽、幻象複製顯示）
 */
export const EFFECTS = CARD_DEFS.map(def => ({
  id: def.effectId,
  name: def.name,
  desc: def.desc,
}));
