import { Player, RawMessage } from "@minecraft/server";
import { hudMessage } from "../../shared/minigame-core/scoreboardHud";

type ColumnDef = {
  template: string;
  getters: Map<string, (player: Player) => string | number>;
};

export class ScoreboardTemplate {
  private columns: Map<string, ColumnDef> = new Map();
  public visible: boolean = true;

  constructor() {
  }

  /**
   * 添加栏目（链式调用）
   * @param columnName 栏目标识名
   * @param template 模板字符串，如 "§f队伍: {team}"
   * @param getters 占位符对应的回调，key 为占位符名，value 为接收 Player 返回数据的函数
   */
  public addColumn(
    columnName: string,
    template: string,
    getters: Record<string, (player: Player) => string | number>
  ): this {
    const getterMap = new Map(Object.entries(getters));
    this.columns.set(columnName, { template, getters: getterMap });
    return this;
  }

  /**
   * 渲染计分板为 RawMessage
   * @param player 当前要渲染计分板的玩家对象
   */
  public render(player: Player): RawMessage {
    const parts: RawMessage[] = [];
    for (const { template, getters } of this.columns.values()) {
      let rendered = template;
      for (const [key, getter] of getters) {
        const value = getter(player);
        rendered = rendered.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
      }
      parts.push({ text: rendered } as RawMessage);
      parts.push({ text: "§r\n" } as RawMessage);
    }
    return hudMessage(parts);
  }
}