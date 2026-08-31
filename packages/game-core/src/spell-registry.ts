export type SpellId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface SpellEffect<TContext, TResult = TContext> {
  readonly spellId: SpellId;
  execute(context: TContext): TResult;
}

export class SpellRegistry<TContext, TResult = TContext> {
  private readonly effects = new Map<SpellId, SpellEffect<TContext, TResult>>();

  constructor(effects: Iterable<SpellEffect<TContext, TResult>>) {
    for (const effect of effects) {
      if (this.effects.has(effect.spellId)) {
        throw new Error(`牌号 ${effect.spellId} 的规则被重复注册`);
      }
      this.effects.set(effect.spellId, effect);
    }
  }

  execute(spellId: SpellId, context: TContext): TResult {
    const effect = this.effects.get(spellId);
    if (!effect) {
      throw new Error(`牌号 ${spellId} 的规则尚未导入`);
    }
    return effect.execute(context);
  }
}
