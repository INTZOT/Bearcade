// ============================================================
// SimulatedPlayerManager:/spm 模拟玩家管理(仅管理员)
// 功能:列出当前世界全部模拟玩家(可删除)、生成新假人(在玩家所在
// 维度与位置生成),主要用途是凑开局人数(模拟玩家是 Player 实体,
// 会被房间人数统计计入)。
// 实现要点:
//  - 使用 @minecraft/server-gametest 模块级 spawnSimulatedPlayer,普通世界可用;
//  - 生成时打 tag `bearcade:simulated`,列表/删除按该 tag 识别;
//  - 命令回调运行在受限上下文,表单与生成延迟到 system.run。
// ============================================================
import {
  system,
  world,
  GameMode,
  type Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { spawnSimulatedPlayer, type SimulatedPlayer } from "@minecraft/server-gametest";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { COMMAND_SPM } from "./config";

/** 模拟玩家识别 tag(生成时打上,列表/删除按此过滤) */
export const SIMULATED_TAG = "bearcade:simulated";

const DEFAULT_NAME = "Simulated Player";

export function registerSpmCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: COMMAND_SPM,
          description: "管理模拟玩家(列表/生成/删除)",
          permissionLevel: CommandPermissionLevel.Admin,
          cheatsRequired: false,
        },
        (origin) => {
          const entity = origin.sourceEntity;
          if (!entity || entity.typeId !== "minecraft:player") {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          const player = entity as Player;
          system.runTimeout(() => openSpmMain(player), 2);
          return {
            status: CustomCommandStatus.Success,
            message: "正在打开模拟玩家管理",
          };
        },
      );
    } catch (error) {
      console.warn("[Toolkit] 注册 /spm 命令失败", error);
    }
  });
}

/** 当前世界全部模拟玩家(按 tag 识别,模拟玩家包含在 getAllPlayers 中) */
function listSimulated(): SimulatedPlayer[] {
  return world
    .getAllPlayers()
    .filter((p): p is SimulatedPlayer => p.hasTag(SIMULATED_TAG));
}

/** 主表单:假人列表(删除)+ 生成入口 */
function openSpmMain(player: Player): void {
  const sims = listSimulated();
  const form = new CustomForm(player, "模拟玩家管理");
  form.header("SimulatedPlayerManager");
  form.spacer();
  form.label(`当前模拟玩家:${sims.length} 个`);
  form.spacer();
  if (sims.length === 0) {
    form.label("§7暂无模拟玩家");
  } else {
    for (const sim of sims) {
      const loc = sim.location;
      const dimShort = sim.dimension.id.split(":")[1] ?? sim.dimension.id;
      form.button(
        `删除 ${sim.name} (${dimShort} ${loc.x.toFixed(0)},${loc.y.toFixed(0)},${loc.z.toFixed(0)})`,
        () => {
          form.close();
          removeSimulated(player, sim);
        },
      );
    }
  }
  form.spacer();
  form.button("生成新假人", () => {
    form.close();
    system.runTimeout(() => openSpmForm(player), 2);
  });
  form.button("关闭", () => form.close());
  form.show().catch((error) => {
    console.warn("[Toolkit] 模拟玩家列表表单失败", error);
  });
}

/** 生成表单:输入名称后在玩家所在维度与位置生成 */
function openSpmForm(player: Player): void {
  const nameObs = new ObservableString(DEFAULT_NAME, {
    clientWritable: true,
  });
  const form = new CustomForm(player, "生成模拟玩家");
  form.header("SimulatedPlayerManager · 生成");
  form.spacer();
  form.label(
    "将在你所在维度与位置生成一个模拟玩家,可用于凑开局人数。",
  );
  form.spacer();
  form.textField("名称", nameObs);
  form.spacer();
  form.button("生成", () => {
    form.close();
    const name = nameObs.getData().trim() || DEFAULT_NAME;
    spawnAtPlayer(player, name);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openSpmMain(player), 2);
  });
  form.show().catch((error) => {
    console.warn("[Toolkit] 模拟玩家生成表单失败", error);
  });
}

function spawnAtPlayer(player: Player, name: string): void {
  try {
    const sim = spawnSimulatedPlayer(
      {
        dimension: player.dimension,
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
      },
      name,
      GameMode.Adventure,
    );
    try {
      sim.addTag(SIMULATED_TAG);
    } catch {
      // 标记失败不影响生成
    }
    player.sendMessage(`§a已生成模拟玩家 §e${name}§a(${sim.id})`);
    console.warn(
      `[Toolkit] 模拟玩家生成:${name}(${sim.id}) @ ${player.dimension.id} (${player.location.x.toFixed(1)}, ${player.location.y.toFixed(1)}, ${player.location.z.toFixed(1)})`,
    );
  } catch (error) {
    player.sendMessage(`§c生成失败:${error}`);
    console.warn("[Toolkit] 模拟玩家生成失败", error);
  }
  system.runTimeout(() => openSpmMain(player), 2);
}

function removeSimulated(player: Player, sim: SimulatedPlayer): void {
  const id = sim.id;
  const name = sim.name;
  try {
    sim.remove();
  } catch (error) {
    // 引擎对模拟玩家的 remove() 可能抛错但实际已移除(实测),以实际状态为准
    console.warn("[Toolkit] 模拟玩家 remove() 抛错,验证实际状态", error);
  }
  system.runTimeout(() => {
    const stillExists = listSimulated().some((s) => s.id === id);
    player.sendMessage(
      stillExists
        ? "§c删除失败:模拟玩家仍存在,请重试"
        : `§a已删除模拟玩家 §e${name}`,
    );
    openSpmMain(player);
  }, 2);
}
