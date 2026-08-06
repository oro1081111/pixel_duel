import type {GameCard, PlayerState} from './state';

/*
 * 主動效果的「實際生效」那一段。
 *
 * UI 與模擬器對同一個效果的流程長得不一樣：UI 要先開啟選取模式、等玩家點目標，
 * 模擬器則由 AI 直接挑好目標一次做完。但「做完之後盤面怎麼變」是同一件事，
 * 以前那段卻在兩邊各寫了一次 —— 例如充能是 +3 還是 ×2、再現複製的是哪個數值。
 *
 * 這裡收的就是那一段：純粹改 PlayerState，不碰階段、不碰選取模式、不碰畫面。
 * 前置條件（階段、幻境封鎖、每區一次）由 engine/activations.ts 判斷，
 * 但這些函式仍會自己檢查魔力與目標是否有效 —— 呼叫端可能隔了一次玩家互動，
 * 中間盤面已經變了。回傳 false / null 代表沒有生效。
 */

const rollDie = (rand: () => number) => 1 + Math.floor(rand() * 6);

// 充能護盾：每 2 魔力換 1 防禦，可重複發動
export function applyShield(p: PlayerState) {
    if (p.magic < 2) return false;
    p.magic -= 2;
    p.defense += 1;
    return true;
}

// 魔力屏障：3 魔力換 3 防禦，每區一次
export function applyBarrier(p: PlayerState, areaIdx: number) {
    if (p.magic < 3 || p.barrierUsedIndices.includes(areaIdx)) return false;
    p.magic -= 3;
    p.defense += 3;
    p.barrierUsedIndices.push(areaIdx);
    return true;
}

// 翡翠突刺：所有強度 1~2 的普通攻擊翻倍。回傳翻倍了幾個；0 代表沒有可翻的目標。
export function applyThrust(p: PlayerState, areaIdx: number) {
    if (p.thrustUsedIndices.includes(areaIdx)) return 0;
    let transformed = 0;
    p.currentAttacks.forEach((areaAtks, aIdx) => {
        areaAtks.forEach((val, hitIdx) => {
            if (val > 0 && val <= 2) {
                p.currentAttacks[aIdx][hitIdx] = val * 2;
                transformed++;
            }
        });
    });
    if (transformed > 0) p.thrustUsedIndices.push(areaIdx);
    return transformed;
}

/*
 * 森林之箭：把全場所有普通攻擊合併成單一次攻擊放在指定區。
 * 因為防禦是逐次扣減，合併通常是巨大的收益 —— 2+2+2 面對 2 防禦是 0 傷害，
 * 合併成 6 則是 4 傷害。
 */
export function applyForest(p: PlayerState, areaIdx: number) {
    if (p.magic < 3 || p.forestUsedIndices.includes(areaIdx)) return false;
    p.magic -= 3;
    const totalSum = p.currentAttacks.flat().reduce((a, b) => a + b, 0);
    p.currentAttacks = [[0], [0], [0]];
    p.currentAttacks[areaIdx] = [totalSum];
    p.forestUsedIndices.push(areaIdx);
    return true;
}

// 紅蓮飛刃：每次攻擊 +1，不消耗魔力
export function applyAmplify(p: PlayerState, areaIdx: number) {
    if (p.amplifyUsedIndices.includes(areaIdx)) return false;
    if (!p.currentAttacks.some(hits => hits.some(v => v > 0))) return false;
    p.currentAttacks = p.currentAttacks.map(hits => hits.map(atk => (atk > 0 ? atk + 1 : 0)));
    p.amplifyUsedIndices.push(areaIdx);
    return true;
}

/*
 * 判定階段花掉的魔力要另外記在 magicSpentInJudging：
 * 判定會被重算（魔運、幻象、命運都會觸發重算），重算時魔力是從骰子重新加總的，
 * 沒有這筆紀錄的話這次花費就會被免費退還。
 */
export function applyHolyLight(p: PlayerState, inJudgingPhase: boolean) {
    if (p.magic < 2) return false;
    p.magic -= 2;
    if (inJudgingPhase) p.magicSpentInJudging += 2;
    p.hp += 1;
    return true;
}

export function applySoulSnatch(p: PlayerState, opp: PlayerState, inJudgingPhase: boolean) {
    if (p.magic < 3) return false;
    p.magic -= 3;
    if (inJudgingPhase) p.magicSpentInJudging += 3;
    opp.hp -= 1;
    p.hp += 1;
    return true;
}

// 魔彈散射：每 1 魔力在該區多一次強度 2 的攻擊，可重複
export function applyMagicBullet(p: PlayerState, areaIdx: number) {
    if (p.magic < 1) return false;
    p.magic -= 1;
    p.currentAttacks[areaIdx].push(2);
    return true;
}

// 魔力貫穿：2 魔力讓指定的一次攻擊 +3
export function applyCharge(
    p: PlayerState,
    sourceAreaIdx: number,
    targetAreaIdx: number,
    hitIdx: number,
) {
    if (p.magic < 2) return false;
    if (!(p.currentAttacks[targetAreaIdx]?.[hitIdx] > 0)) return false;
    p.magic -= 2;
    p.currentAttacks[targetAreaIdx][hitIdx] += 3;
    if (sourceAreaIdx !== -1) p.chargeUsedIndices.push(sourceAreaIdx);
    return true;
}

// 魔力再現：2 魔力讓指定的一次攻擊「視為兩次」（複製同樣數值，不是加倍單次）
export function applyReproduction(
    p: PlayerState,
    sourceAreaIdx: number,
    targetAreaIdx: number,
    hitIdx: number,
) {
    if (p.magic < 2) return false;
    const atkVal = p.currentAttacks[targetAreaIdx]?.[hitIdx];
    if (!(atkVal > 0)) return false;
    p.magic -= 2;
    p.currentAttacks[targetAreaIdx].push(atkVal);
    if (sourceAreaIdx !== -1) p.reproductionUsedIndices.push(sourceAreaIdx);
    return true;
}

// 雙重閃光：3 魔力讓指定的一次攻擊數值翻倍。回傳翻倍後的數值。
export function applyFlare(
    p: PlayerState,
    sourceAreaIdx: number,
    targetAreaIdx: number,
    hitIdx: number,
): number | null {
    if (p.magic < 3) return null;
    const atkVal = p.currentAttacks[targetAreaIdx]?.[hitIdx];
    if (!(atkVal > 0)) return null;
    const newVal = atkVal * 2;
    p.currentAttacks[targetAreaIdx][hitIdx] = newVal;
    p.magic -= 3;
    if (sourceAreaIdx !== -1) p.flareUsedIndices.push(sourceAreaIdx);
    return newVal;
}

// 幻影疾閃：3 魔力無視對手的一次普通攻擊（穿透傷害閃不掉）
export function applyEvasion(
    p: PlayerState,
    opp: PlayerState,
    sourceAreaIdx: number,
    targetAreaIdx: number,
    hitIdx: number,
) {
    if (p.magic < 3) return false;
    if (opp.attackQueue[targetAreaIdx]?.[hitIdx] === undefined) return false;
    p.magic -= 3;
    opp.attackQueue[targetAreaIdx].splice(hitIdx, 1);
    if (sourceAreaIdx !== -1) p.evasionUsedIndices.push(sourceAreaIdx);
    return true;
}

/*
 * 冰霜之箭：捨棄一顆已投擲的骰子，換該區一次強度 1~3 的額外攻擊。
 * 額外攻擊要同時記進 extraFrostAttacks —— 判定會重算 currentAttacks，
 * 只寫 currentAttacks 的話重算後就不見了。
 */
export function applyFrost(
    p: PlayerState,
    sourceAreaIdx: number,
    diceResults: number[],
    dieIdx: number,
    rand: () => number = Math.random,
): {removedVal: number; extraAtk: number} | null {
    if (p.frostUsedIndices.includes(sourceAreaIdx)) return null;
    if (dieIdx < 0 || dieIdx >= diceResults.length) return null;
    const removedVal = diceResults.splice(dieIdx, 1)[0];
    const extraAtk = 1 + Math.floor(rand() * 3);
    p.extraFrostAttacks[sourceAreaIdx].push(extraAtk);
    p.currentAttacks[sourceAreaIdx].push(extraAtk);
    p.frostUsedIndices.push(sourceAreaIdx);
    return {removedVal, extraAtk};
}

// 命運之石：重擲任意數量的已投擲骰子
export function applyFate(
    p: PlayerState,
    sourceAreaIdx: number,
    diceResults: number[],
    dieIndices: number[],
    rand: () => number = Math.random,
) {
    if (dieIndices.length === 0 || diceResults.length === 0) return false;
    dieIndices.forEach(idx => {
        if (idx >= 0 && idx < diceResults.length) diceResults[idx] = rollDie(rand);
    });
    if (sourceAreaIdx !== -1) p.fateUsedIndices.push(sourceAreaIdx);
    return true;
}

// 魔運之石：2 魔力多投一顆骰子。回傳新骰子的點數。
export function applyMagicLuck(
    p: PlayerState,
    areaIdx: number,
    diceResults: number[],
    rand: () => number = Math.random,
): number | null {
    if (p.magic < 2 || p.magicLuckUsedIndices.includes(areaIdx)) return null;
    p.magic -= 2;
    p.magicSpentInJudging += 2;
    const newVal = rollDie(rand);
    diceResults.push(newVal);
    p.magicLuckUsedIndices.push(areaIdx);
    return newVal;
}

// 幻象幽影：1 魔力複製對手一張招式卡的效果到自己這一區
export function applyIllusion(
    p: PlayerState,
    sourceAreaIdx: number,
    targetCard: GameCard | null,
) {
    if (p.magic < 1 || !targetCard || sourceAreaIdx === -1) return false;
    p.magic -= 1;
    p.magicSpentInJudging += 1;
    p.illusionUsedIndices.push(sourceAreaIdx);
    p.illusionCopiedEffectIds[sourceAreaIdx] = targetCard.effectId;
    return true;
}
