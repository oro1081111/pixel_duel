import type {PlayerState} from './state';
import {getEffectiveEffectId, isMirageActive} from './deck';

/*
 * 「這一刻哪些效果可以發動」的單一來源。
 *
 * 這份條件表原本在 UI 與模擬器各寫了一次，兩邊都是 90 行的 if 串。
 * 它們目前只差一個守衛（UI 會擋在幸運骰選取中），但這種一致性沒有任何機制保護 ——
 * 改了魔力門檻或階段而只改一邊，模擬器就會替 AI 評估一個它玩不到的遊戲。
 *
 * 這裡回傳的是「資料」而不是可執行的 thunk：UI 端要接自己的 useXxx()＋render，
 * 模擬器端要接自己的執行函式，各自對照 effectId 去派工即可。
 */

export type ActivationOption = {
    effectId: string;
    areaIdx: number;
};

export type ActivationContext = {
    phaseIndex: number;
    player: PlayerState;
    opponent: PlayerState;
    diceCount: number;
    /** 對手身上有幾個「可被閃避」的來襲攻擊 */
    opponentDodgeTargetCount: number;
    /** 我方有幾個「可被指定強化」的攻擊 */
    selfAttackTargetCount: number;
    hasAnyAttackTarget: boolean;
    hasAnyThrustTarget: boolean;
    /** 對手是否有可被幻象複製的卡 */
    hasCopyableOpponentCard: boolean;
    /** UI 端在幸運骰選取中會擋住其他發動；模擬器傳 false */
    blockedBySelection: boolean;
};

type Rule = {
    phases: number[];
    magicCost: number;
    /** 每區只能發動一次的，記在這個欄位裡 */
    usedField?: keyof PlayerState;
    /** 幻境空間會禁止所有消耗魔力的效果 */
    blockedByMirage: boolean;
    extra?: (ctx: ActivationContext) => boolean;
};

/*
 * 沒有魔力成本的效果（fate/frost/amplify/thrust）不受幻境空間影響 ——
 * 幻境禁的是「消耗魔力之效果」，不是所有效果。
 */
const RULES: Record<string, Rule> = {
    fate: {
        phases: [1, 2], magicCost: 0, usedField: 'fateUsedIndices', blockedByMirage: false,
        extra: ctx => ctx.diceCount > 0,
    },
    frost: {
        phases: [1], magicCost: 0, usedField: 'frostUsedIndices', blockedByMirage: false,
    },
    magic_luck: {
        phases: [2], magicCost: 2, usedField: 'magicLuckUsedIndices', blockedByMirage: true,
    },
    illusion: {
        phases: [2], magicCost: 1, usedField: 'illusionUsedIndices', blockedByMirage: true,
        extra: ctx => ctx.hasCopyableOpponentCard,
    },
    dodge: {
        phases: [3], magicCost: 3, usedField: 'evasionUsedIndices', blockedByMirage: true,
        extra: ctx => ctx.opponentDodgeTargetCount > 0,
    },
    shield: {
        // 充能護盾可重複發動（每 2 魔力 +1 防禦），所以沒有 usedField
        phases: [3], magicCost: 2, blockedByMirage: true,
    },
    barrier: {
        phases: [3], magicCost: 3, usedField: 'barrierUsedIndices', blockedByMirage: true,
    },
    amplify: {
        phases: [5], magicCost: 0, usedField: 'amplifyUsedIndices', blockedByMirage: false,
        extra: ctx => ctx.hasAnyAttackTarget,
    },
    magic_bullet: {
        // 每 1 魔力多一次強度 2 的攻擊，可重複
        phases: [5], magicCost: 1, blockedByMirage: true,
    },
    thrust: {
        phases: [5], magicCost: 0, usedField: 'thrustUsedIndices', blockedByMirage: false,
        extra: ctx => ctx.hasAnyThrustTarget,
    },
    forest: {
        phases: [5], magicCost: 3, usedField: 'forestUsedIndices', blockedByMirage: true,
    },
    charge: {
        phases: [5], magicCost: 2, usedField: 'chargeUsedIndices', blockedByMirage: true,
        extra: ctx => ctx.selfAttackTargetCount > 0,
    },
    reproduction: {
        phases: [5], magicCost: 2, usedField: 'reproductionUsedIndices', blockedByMirage: true,
        extra: ctx => ctx.selfAttackTargetCount > 0,
    },
    flare: {
        phases: [5], magicCost: 3, usedField: 'flareUsedIndices', blockedByMirage: true,
        extra: ctx => ctx.selfAttackTargetCount > 0,
    },
    holy_light: {
        // [任意階段]，但實際只在傷害/攻擊階段有發動時機
        phases: [4, 5], magicCost: 2, blockedByMirage: true,
    },
    soul_snatch: {
        phases: [4, 5], magicCost: 3, blockedByMirage: true,
    },
};

export function getActivationMagicCost(effectId: string | null | undefined) {
    return (effectId && RULES[effectId]?.magicCost) || 0;
}

export function isMagicSpendActivation(effectId: string | null | undefined) {
    return getActivationMagicCost(effectId) > 0;
}

export function listActivations(ctx: ActivationContext): ActivationOption[] {
    if (ctx.blockedBySelection) return [];
    const p = ctx.player;
    const mirageBlocked = isMirageActive([p, ctx.opponent]);
    const out: ActivationOption[] = [];

    for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
        /*
         * 幻象幽影自己的發動看的是「卡面」而不是「有效效果」：
         * 已經複製過對手效果的那一區，effective id 會變成被複製的效果，
         * 若用 effective id 判斷就會允許它再複製一次。
         */
        const cardEffectId = p.activeAreaEffects[areaIdx]?.effectId ?? null;
        const effId = cardEffectId === 'illusion' && !p.illusionUsedIndices.includes(areaIdx)
            ? 'illusion'
            : getEffectiveEffectId(p, areaIdx);
        if (!effId) continue;

        const rule = RULES[effId];
        if (!rule) continue;
        if (!rule.phases.includes(ctx.phaseIndex)) continue;
        if (rule.magicCost > 0 && p.magic < rule.magicCost) continue;
        if (rule.blockedByMirage && mirageBlocked) continue;
        if (rule.usedField) {
            const used = p[rule.usedField] as number[];
            if (used.includes(areaIdx)) continue;
        }
        if (rule.extra && !rule.extra(ctx)) continue;

        out.push({effectId: effId, areaIdx});
    }
    return out;
}
