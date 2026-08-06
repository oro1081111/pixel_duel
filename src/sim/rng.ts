/*
 * 可重現的亂數來源。
 *
 * Bandit AI 的 rollout 需要兩件事是 Math.random() 給不了的：
 *  1. 可重現 —— 出問題時要能重播同一組模擬。
 *  2. Common Random Numbers —— 同一輪比較裡，第 i 次 rollout 對所有候選都餵同一組
 *     骰子。候選之間的差異才會是「決策本身的差異」，而不是「誰運氣好」。
 *     沒有這個，抽樣誤差會大到需要好幾倍的 rollout 才分得出高下。
 */

export type Rng = () => number;

// mulberry32：小、快、統計性質對這個用途夠好，且 seed 可控。
export function makeRng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/*
 * 模擬器內部所有亂數都走這個 source。
 * 平常是 Math.random，rollout 期間由 bandit 換成固定 seed 的 RNG。
 * 用可切換的全域來源是刻意的取捨：替代方案是把 rng 參數穿過幾十個函式，
 * 對這個規模的專案不划算，而且 rollout 是同步執行的，不會有交錯問題。
 */
let current: Rng = Math.random;

export function rng() {
    return current();
}

export function randInt(minInclusive: number, maxInclusive: number) {
    return Math.floor(current() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

export function chooseUniform<T>(arr: T[]): T {
    return arr[Math.floor(current() * arr.length)];
}

/** 用指定的 RNG 執行一段程式，結束後還原（含例外時）。 */
export function withRng<T>(source: Rng, fn: () => T): T {
    const prev = current;
    current = source;
    try {
        return fn();
    } finally {
        current = prev;
    }
}
