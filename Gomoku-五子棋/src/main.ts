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

system.beforeEvents.startup.subscribe((event) => {
  // 注册房间维度 bearcade:gomoku_1 ~ bearcade:gomoku_8
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    event.dimensionRegistry.registerCustomDimension(roomDimensionId(roomId));
  }
  // 注册模板维度 bearcade:gomoku_template(场地源,不承载对局)
  event.dimensionRegistry.registerCustomDimension(TEMPLATE_DIMENSION_ID);

  // 开发辅助:进入模板维度制作场地
  event.customCommandRegistry.registerCommand(
    {
      name: "bearcade:gomoku",
      description: "开发用:进入五子棋模板维度制作场地",
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
      const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
      player.teleport(TEMPLATE_SPAWN, { dimension });
      return {
        status: CustomCommandStatus.Success,
        message: `已传送至模板维度 ${TEMPLATE_DIMENSION_ID}`,
      };
    },
  );

  console.warn(
    `[Bearcade Gomoku] 已注册 ${GAME_ID} 房间维度 1~${ROOM_COUNT} 与模板维度`,
  );
});
