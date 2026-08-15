import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import type { Vec3 } from "./types";

export interface RegionLike {
  from: Vec3;
  to: Vec3;
}

function parseIntValue(value: ObservableString): number | undefined {
  const n = Number(value.getData());
  return Number.isInteger(n) ? n : undefined;
}

export function openConfigMenu(
  player: Player,
  title: string,
  entries: { label: string; open: () => void }[],
): void {
  const form = new CustomForm(player, title);
  form.header("配置");
  form.spacer();
  for (const entry of entries) {
    form.button(entry.label, () => {
      form.close();
      system.runTimeout(entry.open, 2);
    });
  }
  form.spacer();
  form.button("关闭", () => form.close());
  form.show().catch((error) => console.warn("[Bearcade Config] 菜单失败", error));
}

export function openVec3Editor(
  player: Player,
  title: string,
  current: Vec3,
  onSave: (value: Vec3) => void,
  back?: () => void,
): void {
  const x = new ObservableString(String(current.x), { clientWritable: true });
  const y = new ObservableString(String(current.y), { clientWritable: true });
  const z = new ObservableString(String(current.z), { clientWritable: true });
  const form = new CustomForm(player, title);
  form.header(title);
  form.spacer();
  form.label("方块坐标(整数)。传送类坐标会自动加 0.5 到方块中心。");
  form.spacer();
  form.textField("X", x);
  form.textField("Y", y);
  form.textField("Z", z);
  form.spacer();
  form.button("保存", () => {
    const nx = parseIntValue(x);
    const ny = parseIntValue(y);
    const nz = parseIntValue(z);
    if (nx === undefined || ny === undefined || nz === undefined) {
      player.sendMessage("§c请输入整数坐标");
      return;
    }
    form.close();
    onSave({ x: nx, y: ny, z: nz });
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    if (back) system.runTimeout(back, 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Config] 坐标表单失败", error));
}

export function openRegionEditor(
  player: Player,
  title: string,
  current: RegionLike,
  onSave: (value: RegionLike) => void,
  back?: () => void,
): void {
  const fromX = new ObservableString(String(current.from.x), {
    clientWritable: true,
  });
  const fromY = new ObservableString(String(current.from.y), {
    clientWritable: true,
  });
  const fromZ = new ObservableString(String(current.from.z), {
    clientWritable: true,
  });
  const toX = new ObservableString(String(current.to.x), { clientWritable: true });
  const toY = new ObservableString(String(current.to.y), { clientWritable: true });
  const toZ = new ObservableString(String(current.to.z), { clientWritable: true });
  const form = new CustomForm(player, title);
  form.header(title);
  form.spacer();
  form.label("填写区域两个对角方块坐标(整数,含端点)。");
  form.spacer();
  form.textField("起点 X", fromX);
  form.textField("起点 Y", fromY);
  form.textField("起点 Z", fromZ);
  form.textField("终点 X", toX);
  form.textField("终点 Y", toY);
  form.textField("终点 Z", toZ);
  form.spacer();
  form.button("保存", () => {
    const values = [fromX, fromY, fromZ, toX, toY, toZ].map(parseIntValue);
    if (values.some((v) => v === undefined)) {
      player.sendMessage("§c请输入整数坐标");
      return;
    }
    form.close();
    // 用户可能把两个对角填反:统一归一化为 from=min, to=max,保证区域判定可用
    onSave({
      from: {
        x: Math.min(values[0]!, values[3]!),
        y: Math.min(values[1]!, values[4]!),
        z: Math.min(values[2]!, values[5]!),
      },
      to: {
        x: Math.max(values[0]!, values[3]!),
        y: Math.max(values[1]!, values[4]!),
        z: Math.max(values[2]!, values[5]!),
      },
    });
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    if (back) system.runTimeout(back, 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Config] 区域表单失败", error));
}

export function openIntEditor(
  player: Player,
  title: string,
  current: number,
  onSave: (value: number) => void,
  options?: { min?: number; max?: number; hint?: string; back?: () => void },
): void {
  const input = new ObservableString(String(current), { clientWritable: true });
  const form = new CustomForm(player, title);
  form.header(title);
  form.spacer();
  form.label(options?.hint ?? "请输入整数。");
  form.spacer();
  form.textField("数值", input);
  form.spacer();
  form.button("保存", () => {
    const value = parseIntValue(input);
    if (value === undefined) {
      player.sendMessage("§c请输入整数");
      return;
    }
    if (
      (options?.min !== undefined && value < options.min) ||
      (options?.max !== undefined && value > options.max)
    ) {
      player.sendMessage("§c数值超出允许范围");
      return;
    }
    form.close();
    onSave(value);
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    if (options?.back) system.runTimeout(options.back, 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Config] 数值表单失败", error));
}
