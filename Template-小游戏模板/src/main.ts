import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import {
  GAME_ID,
  ROOM_COUNT,
  TEMPLATE_DIMENSION_ID,
  TEMPLATE_SPAWN,
  roomDimensionId,
} from "./config";
import { initRooms } from "./rooms";
import { sendGameRegister, sendRoomStatus } from "./ipc";
import { forceStopInDimension, initGame, tickGames } from "./game";

system.beforeEvents.startup.subscribe((event) => {
  // 注册房间维度 bearcade:mygame_1 ~ bearcade:mygame_N
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    event.dimensionRegistry.registerCustomDimension(roomDimensionId(roomId));
  }
  // 注册模板维度 bearcade:mygame_template(场地源)
  event.dimensionRegistry.registerCustomDimension(TEMPLATE_DIMENSION_ID);

  // 开发辅助:进入模板维度制作场地
  event.customCommandRegistry.registerCommand(
    {
      name: `bearcade:${GAME_ID}`,
      description: "开发用:进入模板维度制作场地",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "该命令只能由玩家执行",
        };
      }
      system.run(() => {
        const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
        player.teleport(TEMPLATE_SPAWN, { dimension });
      });
      return {
        status: CustomCommandStatus.Success,
        message: `已传送至模板维度 ${TEMPLATE_DIMENSION_ID}`,
      };
    },
  );

  // 强制中断当前维度运行中的对局
  event.customCommandRegistry.registerCommand(
    {
      name: `bearcade:${GAME_ID}_stop`,
      description: "强制中断当前维度运行中的对局",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: false,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "该命令只能由玩家执行",
        };
      }
      if (!forceStopInDimension(player.dimension.id)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "当前维度没有运行中的对局",
        };
      }
      return {
        status: CustomCommandStatus.Success,
        message: "已强制中断当前对局",
      };
    },
  );

  console.warn(
    `[Bearcade Template] 已注册 ${GAME_ID} 房间维度 1~${ROOM_COUNT} 与模板维度`,
  );
});

world.afterEvents.worldLoad.subscribe(() => {
  sendGameRegister();
  void initRooms();
  initGame();
  // 对局状态机:每 10 tick(0.5 秒)检查一次
  system.runInterval(() => tickGames(), 10);
  // 5 秒心跳兜底上报
  system.runInterval(() => sendRoomStatus(), 100);
});
