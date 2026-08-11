// Gomoku-五子棋/src/main.ts
import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel
} from "@minecraft/server";

// Gomoku-五子棋/src/config.ts
var GAME_ID = "gomoku";
var ROOM_COUNT = 8;
var DIMENSION_NAMESPACE = "bearcade";
var TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
var TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
function roomDimensionId(roomId) {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}

// Gomoku-五子棋/src/main.ts
system.beforeEvents.startup.subscribe((event) => {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    event.dimensionRegistry.registerCustomDimension(roomDimensionId(roomId));
  }
  event.dimensionRegistry.registerCustomDimension(TEMPLATE_DIMENSION_ID);
  event.customCommandRegistry.registerCommand(
    {
      name: "bearcade:gomoku",
      description: "\u5F00\u53D1\u7528:\u8FDB\u5165\u4E94\u5B50\u68CB\u6A21\u677F\u7EF4\u5EA6\u5236\u4F5C\u573A\u5730",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "\u8BE5\u547D\u4EE4\u53EA\u80FD\u7531\u73A9\u5BB6\u6267\u884C"
        };
      }
      system.run(() => {
        const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
        player.teleport(TEMPLATE_SPAWN, { dimension });
      });
      return {
        status: CustomCommandStatus.Success,
        message: `\u5DF2\u4F20\u9001\u81F3\u6A21\u677F\u7EF4\u5EA6 ${TEMPLATE_DIMENSION_ID}`
      };
    }
  );
  console.warn(
    `[Bearcade Gomoku] \u5DF2\u6CE8\u518C ${GAME_ID} \u623F\u95F4\u7EF4\u5EA6 1~${ROOM_COUNT} \u4E0E\u6A21\u677F\u7EF4\u5EA6`
  );
});
//# sourceMappingURL=main.js.map
