import type {AttrType} from './cards';

export type BaseBarAttr = {
    type: AttrType;
    value: number;
};

export type BaseBarDef = {
    /**
     * Image path under `public/`.
     * Example: `public/basebars/p0_zone0.png` => use `basebars/p0_zone0.png` here.
     */
    img: string;
    left: BaseBarAttr;
    right: BaseBarAttr;
};

/**
 * Editable base-bar table.
 *
 * - 2 players (p0 / p1)
 * - 3 zones per player (zone0/1/2)
 *
 * This table is used for BOTH:
 * 1) UI display of the "base bars" above each zone (a single horizontal image)
 * 2) Judging calculation: dice base attribute contribution (so values can be != 1)
 */
export const BASE_BARS: [BaseBarDef[], BaseBarDef[]] = [
    // Player 0
    [
        { img: 'basebars/p0_zone0.png', left: {type: 'gold', value: 1}, right: {type: 'attack', value: 1} },
        { img: 'basebars/p0_zone1.png', left: {type: 'attack', value: 1}, right: {type: 'gold', value: 1} },
        { img: 'basebars/p0_zone2.png', left: {type: 'defense', value: 1}, right: {type: 'magic', value: 1} },
    ],

    // Player 1
    [
        { img: 'basebars/p1_zone0.png', left: {type: 'magic', value: 1}, right: {type: 'attack', value: 1} },
        { img: 'basebars/p1_zone1.png', left: {type: 'attack', value: 1}, right: {type: 'defense', value: 1} },
        { img: 'basebars/p1_zone2.png', left: {type: 'gold', value: 1}, right: {type: 'magic', value: 1} },
    ],
];

export function getBaseBarDef(playerIdx: 0 | 1, zoneIdx: 0 | 1 | 2): BaseBarDef {
    return BASE_BARS[playerIdx][zoneIdx];
}

export function getBaseBarImg(playerIdx: 0 | 1, zoneIdx: 0 | 1 | 2): string {
    return getBaseBarDef(playerIdx, zoneIdx).img;
}

/**
 * Dice value mapping:
 * - 1/2 => zone 0, left/right
 * - 3/4 => zone 1, left/right
 * - 5/6 => zone 2, left/right
 */
export function getBaseAttrForDie(playerIdx: 0 | 1, dieValue: number): BaseBarAttr {
    const v = Math.max(1, Math.min(6, Math.floor(dieValue)));
    const zoneIdx = Math.floor((v - 1) / 2) as 0 | 1 | 2;
    const isLeft = (v % 2 !== 0);
    const def = getBaseBarDef(playerIdx, zoneIdx);
    return isLeft ? def.left : def.right;
}
