// ============================================================
// 天黑请闭眼 · 遗言系统(TextPrimitive 浮空字)
// 玩家出局后弹出表单填写遗言(可留空),提交后在死亡位置留下浮空字;
// 表单被直接关闭时按"空"处理。浮空字在游戏结束时统一移除。
// ============================================================
import {
  world,
  TextPrimitive,
  type Dimension,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";

const MAX_TESTAMENT_LENGTH = 50;

export function spawnTestament(
  dimension: Dimension,
  seat: Vector3,
  text: string,
): TextPrimitive {
  const content = text.trim().slice(0, MAX_TESTAMENT_LENGTH) || "空";
  const shape = new TextPrimitive(
    {
      x: seat.x + 0.5,
      y: seat.y + 2.6,
      z: seat.z + 0.5,
    },
    `§l§o遗言是 §e${content}`,
  );
  // visibleTo 留空 = 所有人可见
  world.primitiveShapesManager.addText(shape, dimension);
  return shape;
}

export function promptTestament(
  player: Player,
  onSubmit: (text: string) => void,
): void {
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "遗言");
  form.label(
    "§e你已出局。§r留下你的遗言吧(可留空,最多 50 字)。\n§7关闭表单 = 留空。",
  );
  form.spacer();
  form.textField("你的遗言", input);
  form.spacer();
  form.button("提交", () => {
    form.close();
    onSubmit(input.getData());
  });
  form.show().catch(() => {
    // 玩家直接关闭表单:按空遗言处理
    onSubmit("");
  });
}
