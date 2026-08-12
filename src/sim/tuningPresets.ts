import {
  type BanditConfig,
  type LadderStep,
  FATE_TARGET_LADDER,
} from './bandit';

/** 對照用：命運之石加深前的舊階梯。 */
export const FATE_TARGET_LADDER_LEAN: LadderStep[] = [
  {samples: 1, keep: 16},
  {samples: 2, keep: 8},
  {samples: 4, keep: 4},
  {samples: 8, keep: 2},
  {samples: 16, keep: 1},
];

/** 實驗 preset：保留 CLI A/B 用，不屬於 production 專家設定。 */
export const GENTLE_BANDIT_CONFIG: BanditConfig = {
  playPool: 512,
  playLadder: [
    {samples: 1, keep: 256},
    {samples: 1, keep: 128},
    {samples: 1, keep: 64},
    {samples: 1, keep: 32},
    {samples: 2, keep: 16},
    {samples: 4, keep: 8},
    {samples: 8, keep: 4},
    {samples: 16, keep: 2},
    {samples: 32, keep: 1},
  ],
  effectBudget: 100,
  targetBudget: 60,
  simulateTargets: true,
  fateLadder: FATE_TARGET_LADDER,
};

export const HALVING_BANDIT_CONFIG: BanditConfig = {
  playPool: 512,
  playLadder: [
    {samples: 1, keep: 256},
    {samples: 1, keep: 128},
    {samples: 1, keep: 64},
    {samples: 1, keep: 32},
    {samples: 1, keep: 16},
    {samples: 2, keep: 8},
    {samples: 4, keep: 4},
    {samples: 8, keep: 2},
    {samples: 16, keep: 1},
  ],
  effectBudget: 100,
  targetBudget: 60,
  simulateTargets: true,
  fateLadder: FATE_TARGET_LADDER,
};

export const LEGACY_BANDIT_CONFIG: BanditConfig = {
  playPool: 384,
  playLadder: [
    {samples: 1, keep: 192},
    {samples: 1, keep: 96},
    {samples: 1, keep: 48},
    {samples: 1, keep: 32},
    {samples: 1, keep: 16},
    {samples: 3, keep: 8},
    {samples: 7, keep: 4},
    {samples: 15, keep: 2},
    {samples: 30, keep: 1},
  ],
  effectBudget: 100,
  targetBudget: 60,
  simulateTargets: true,
  fateLadder: FATE_TARGET_LADDER,
};
