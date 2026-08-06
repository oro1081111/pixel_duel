import type {CardAttr, PlayerState} from './state';
import {getBaseAttrForDie} from '../basebars';
import {getEffectiveEffectId, hasActiveEffect} from './deck';

/*
 * 判定階段與傷害階段的結算。
 *
 * 這兩段是整套規則裡最長、被動效果交互最密集的部分（突破、湧動、幻境、導流、
 * 炎盾、光輝、飛刀、疾風、暗影、反噬、契約…），而它原本在 UI 與模擬器各存在
 * 一份幾乎逐行相同的實作。AI 之後要用模擬決策，它算出來的「這樣打會造成多少
 * 傷害」必須跟玩家實際看到的結果是同一個函式算的，否則差異會直接變成錯誤決策。
 *
 * 這裡只動 PlayerState，不碰勝負判定與畫面提示 —— 那些留給呼叫端。
 * log 是選用的：UI 會傳入寫入戰報的函式，模擬器不傳（跑幾千局不需要文字）。
 */

export type LogFn = (msg: string) => void;
const NO_LOG: LogFn = () => {};

function addAttr(
    attr: CardAttr,
    areaIdx: number,
    sums: number[],
    defense: number[],
    magic: number[],
    gold: number[],
) {
    if (attr.type === 'attack') sums[areaIdx] += attr.value;
    else if (attr.type === 'defense') defense[areaIdx] += attr.value;
    else if (attr.type === 'magic') magic[areaIdx] += attr.value;
    else if (attr.type === 'gold') gold[areaIdx] += attr.value;
}

/*
 * 判定：把骰子換算成該回合的攻/防/魔/金，並套用所有被動效果。
 * 直接改寫 p 的 currentAttacks / piercingAttacks / defense / magic / gold。
 *
 * 效果的先後順序是有意義的，不能重排：
 *   突破（全部翻倍）→ 金 → 湧動（魔翻倍）→ 魔 → 幻境（+攻+防）→ 導流（魔補到 5）
 *   → 扣掉判定中已花的魔力 → 炎盾/光輝（改攻防）→ 定案 → 穿透類（飛刀/疾風/暗影）
 * 例如導流若排在扣魔力之後，判定中花掉的魔力就會被免費補回來。
 */
export function resolveJudging(
    p: PlayerState,
    playerIdx: 0 | 1,
    diceResults: number[],
    log: LogFn = NO_LOG,
) {
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
    p.breakthroughApplied = false;

    const areaSums = [0, 0, 0];
    const areaDefense = [0, 0, 0];
    const areaMagic = [0, 0, 0];
    const areaGold = [0, 0, 0];
    const diceCountsPerArea = [0, 0, 0];

    diceResults.forEach(val => {
        // 骰面 1~6 對應三個區域，奇數看左屬性、偶數看右屬性
        const areaIdx = Math.floor((val - 1) / 2);
        diceCountsPerArea[areaIdx]++;
        const isLeft = val % 2 !== 0;

        addAttr(getBaseAttrForDie(playerIdx, val), areaIdx, areaSums, areaDefense, areaMagic, areaGold);
        p.board[areaIdx].forEach(card => {
            addAttr(isLeft ? card.left : card.right, areaIdx, areaSums, areaDefense, areaMagic, areaGold);
        });
    });

    // 傷害階段若生命掉到 <= 3，臨界突破會補一次翻倍，需要這份「翻倍前」的底值
    p.turnBaseStats = {
        sums: [...areaSums],
        defense: [...areaDefense],
        magic: [...areaMagic],
        gold: [...areaGold],
    };

    if (hasActiveEffect(p, 'breakthrough') && p.hp <= 3) {
        log('[臨界突破]判定成功，所有數值翻倍！');
        for (let i = 0; i < 3; i++) {
            areaSums[i] *= 2;
            areaDefense[i] *= 2;
            areaMagic[i] *= 2;
            areaGold[i] *= 2;
        }
        p.breakthroughApplied = true;
    }

    p.gold = areaGold.reduce((a, b) => a + b, 0);

    p.activeAreaEffects.forEach((_, aIdx) => {
        if (getEffectiveEffectId(p, aIdx) === 'surge' && areaMagic[aIdx] > 0) {
            const before = areaMagic[aIdx];
            areaMagic[aIdx] *= 2;
            log(`[魔能湧動] ${aIdx + 1} 魔力翻倍: ${before} -> ${areaMagic[aIdx]}`);
        }
    });

    p.magic = areaMagic.reduce((a, b) => a + b, 0);

    p.activeAreaEffects.forEach((_, aIdx) => {
        if (getEffectiveEffectId(p, aIdx) === 'mirage') {
            areaSums[aIdx] += 2;
            areaDefense[aIdx] += 1;
            log(`[幻境] 區域 ${aIdx + 1} 基本攻擊額外 +2，防禦力額外 +1`);
        }
    });

    if (hasActiveEffect(p, 'diversion') && p.magic <= 2) {
        log(`[導流] 判定魔力(${p.magic}) <= 2，自動啟動導流提升至 5 點魔力`);
        p.magic = 5;
    }

    // 判定階段中已花掉的魔力只扣這一次，重複扣會讓魔運之石之類的效果被收兩次錢
    p.magic = Math.max(0, p.magic - p.magicSpentInJudging);

    p.activeAreaEffects.forEach((_, aIdx) => {
        const effId = getEffectiveEffectId(p, aIdx);
        if (effId === 'flame_shield') {
            const def = areaDefense[aIdx];
            if (def > 0) {
                areaSums[aIdx] += def * 2;
                log(`[炎盾] 區域 ${aIdx + 1} 轉化 ${def} 點防禦為 ${def * 2} 點攻擊`);
                // 「必視為攻擊」＝ 這些防禦不再是防禦
                areaDefense[aIdx] = 0;
            }
        }
        if (effId === 'brilliance' && diceCountsPerArea[aIdx] >= 3) {
            areaSums[aIdx] += 7;
            log(`[光輝] 區域 ${aIdx + 1} 檢測到 ${diceCountsPerArea[aIdx]} 顆骰子(>=3)，攻擊力額外 +7`);
        }
    });

    p.defense = areaDefense.reduce((a, b) => a + b, 0);
    p.currentAttacks = areaSums.map((s, idx) => [s, ...(p.extraFrostAttacks[idx] ?? [])]);
    p.piercingAttacks = [[], [], []];

    p.activeAreaEffects.forEach((_, aIdx) => {
        const effId = getEffectiveEffectId(p, aIdx);
        if (effId === 'ambush') {
            p.piercingAttacks[aIdx].push(1);
        }
        if (effId === 'gale') {
            const bonus = diceCountsPerArea[aIdx];
            if (bonus > 0) {
                p.piercingAttacks[aIdx].push(bonus);
                log(`[疾風] 區域 ${aIdx + 1} 檢測到 ${bonus} 顆骰子，造成 ${bonus} 點無法防禦傷害`);
            }
        }
        if (effId === 'shadow' && diceCountsPerArea[aIdx] === 0) {
            p.piercingAttacks[aIdx].push(3);
            log(`[暗影] 區域 ${aIdx + 1} 無任何骰子，造成 3 點無法防禦傷害`);
        }
    });

    log(`合計: 攻[${p.currentAttacks.map(v => v.reduce((a, b) => a + b, 0))}], 防:${p.defense}, 魔:${p.magic}, 金:${p.gold}`);
}

export type DamageResult = {
    totalDamage: number;
    /** 生命歸零且沒有被不滅契約救回 */
    defeated: boolean;
};

/*
 * 傷害階段：結算對手上一回合排入 attackQueue / piercingQueue 的攻擊。
 * 會清空對手的攻擊佇列，並回傳結果讓呼叫端決定勝負與提示文字。
 */
export function resolveDamagePhase(
    p: PlayerState,
    opp: PlayerState,
    log: LogFn = NO_LOG,
): DamageResult {
    const hpBeforeDamage = p.hp;
    p.contractTriggeredAreaIdx = -1;

    // 反噬之盾：擋下對手「所有」普通攻擊才會觸發（一次都沒被打穿）
    const backfireCount = p.activeAreaEffects.filter((_, i) => getEffectiveEffectId(p, i) === 'backfire').length;
    if (backfireCount > 0) {
        const normalHits = opp.attackQueue.flat();
        const successfullyDefended = normalHits.every(atk => Math.max(0, atk - p.defense) <= 0);
        if (successfullyDefended) {
            log(`[效果] 反噬觸發！成功擋下所有普通攻擊 (防禦: ${p.defense})`);
            p.activeAreaEffects.forEach((c, aIdx) => {
                if (c && getEffectiveEffectId(p, aIdx) === 'backfire') {
                    p.piercingAttacks[aIdx].push(2);
                    log(`[反噬] 區域 ${aIdx + 1} 產生 2 點穿透反擊傷害`);
                }
            });
        } else {
            const failed = normalHits.filter(atk => atk > p.defense).length;
            log(`[反噬] 未觸發: 尚有 ${failed} 個攻擊穿透防禦`);
        }
    }

    let totalDamage = 0;
    // 防禦是逐次扣減，不是扣總量 —— 面對 2 防禦時 2+2+2 全被擋下，單一個 6 則進 4 點
    opp.attackQueue.forEach((hits, i) => {
        hits.forEach(atk => {
            const dmg = Math.max(0, atk - p.defense);
            totalDamage += dmg;
            if (dmg > 0) log(`區域 ${i + 1} 攻擊 ${atk}: 造成 ${dmg} 傷害`);
        });
    });
    opp.piercingQueue.forEach((hits, i) => {
        hits.forEach(atk => {
            totalDamage += atk;
            log(`區域 ${i + 1} 突擊 ${atk}: 造成 ${atk} 點穿透物理傷害`);
        });
    });

    p.hp -= totalDamage;
    log(totalDamage === 0 ? '完美防禦！未受到任何傷害' : `本輪承受總傷害: ${totalDamage}, 剩餘 HP: ${p.hp}`);

    // 不滅契約：受致命傷前生命 >= 4 才保得住
    if (p.hp <= 0 && hpBeforeDamage >= 4) {
        const contractIdx = p.activeAreaEffects.findIndex((_, i) => getEffectiveEffectId(p, i) === 'contract');
        if (contractIdx !== -1) {
            p.hp = 1;
            p.contractTriggeredAreaIdx = contractIdx;
            log('[效果] 契約觸發！受到致命傷但生命曾 >= 4，保存生命點數為 1');
        }
    }

    /*
     * 臨界突破的補發：判定當下生命還高於 3 時沒觸發，
     * 但這一擊把生命打到 <= 3，仍應享有翻倍。用判定時存下的底值再加一次。
     */
    if (p.hp <= 3 && !p.breakthroughApplied && hasActiveEffect(p, 'breakthrough')) {
        log('[突破] 受到攻擊生命降至 <= 3，判定獲得的所有數值 (攻/防/魔/金) 獲得額外翻倍！');
        p.magic += p.turnBaseStats.magic.reduce((a, b) => a + b, 0);
        p.gold += p.turnBaseStats.gold.reduce((a, b) => a + b, 0);
        p.defense += p.turnBaseStats.defense.reduce((a, b) => a + b, 0);
        p.turnBaseStats.sums.forEach((s, i) => {
            if (s > 0) p.currentAttacks[i][0] += s;
        });
        p.breakthroughApplied = true;
    }

    opp.attackQueue = [[], [], []];
    opp.piercingQueue = [[], [], []];
    opp.currentAttacks = [[0], [0], [0]];
    opp.piercingAttacks = [[], [], []];

    return {totalDamage, defeated: p.hp <= 0};
}
