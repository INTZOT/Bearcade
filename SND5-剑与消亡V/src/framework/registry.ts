// ============================================================
// 泛型注册表(意见③:内容层统一注册模式)
// - 内容层定义文件通过 defineXxx() 在模块加载时注册;
// - 重复 id 与非法 id 立即抛错(fail-fast),配合 npm run typecheck
//   把"改数值不碰框架"从约定变成编译期保证;
// - 注册表只存"定义"(静态数据),运行时实例归各会话系统持有。
// ============================================================
import type { SkillDefinition } from "./skill/types";
import type { StatusDefinition } from "./status/types";

const SND5_ID_PATTERN = /^snd5:[a-z0-9_]+$/;

export class Registry<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(
    public readonly kind: string,
    private readonly idPattern: RegExp = SND5_ID_PATTERN,
  ) {}

  /** 注册一条定义;重复 id 或非法 id 抛错 */
  register(def: T): T {
    if (!this.idPattern.test(def.id)) {
      throw new Error(`[SND5] 非法 ${this.kind} id: ${def.id}(须形如 snd5:xxx)`);
    }
    if (this.items.has(def.id)) {
      throw new Error(`[SND5] 重复注册 ${this.kind}: ${def.id}`);
    }
    this.items.set(def.id, def);
    return def;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /** 取定义,缺失时抛错(用于内容层间的强依赖) */
  require(id: string): T {
    const def = this.items.get(id);
    if (!def) throw new Error(`[SND5] 未注册的 ${this.kind}: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  all(): readonly T[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }

  /** 仅测试用:清空注册表 */
  clear(): void {
    this.items.clear();
  }
}

// ── 全局注册表单例(内容层 import 后调用 register) ────────────────
export const skillRegistry = new Registry<SkillDefinition>("skill");
export const statusRegistry = new Registry<StatusDefinition>("status");
