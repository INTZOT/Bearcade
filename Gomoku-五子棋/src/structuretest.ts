import {
  system,
  world,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";

const TEST_DIMENSION_ID = "bearcade:gomoku_template";

interface TestCase {
  id: string;
  label: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
}

const CASES: TestCase[] = [
  {
    id: "bearcade:stest_64",
    label: "64×384×64",
    from: { x: -32, y: -64, z: -32 },
    to: { x: 31, y: 319, z: 31 },
  },
  {
    id: "bearcade:stest_65",
    label: "65×384×65",
    from: { x: -32, y: -64, z: -32 },
    to: { x: 32, y: 319, z: 32 },
  },
  {
    id: "bearcade:stest_100",
    label: "100×384×100",
    from: { x: -50, y: -64, z: -50 },
    to: { x: 49, y: 319, z: 49 },
  },
];

async function runTest(): Promise<void> {
  const dimension = world.getDimension(TEST_DIMENSION_ID);
  for (const test of CASES) {
    try {
      if (world.structureManager.get(test.id)) {
        world.structureManager.delete(test.id);
      }
      const structure = world.structureManager.createFromWorld(
        test.id,
        dimension,
        test.from,
        test.to,
      );
      const size = structure.size;
      console.warn(
        `[StructureTest] ${test.label}(${test.id}): OK size=${size.x}x${size.y}x${size.z}`,
      );
      world.structureManager.delete(test.id);
    } catch (error) {
      console.warn(
        `[StructureTest] ${test.label}(${test.id}): FAILED ${String(error)}`,
      );
    }
  }
  console.warn("[StructureTest] 测试完成");
}

export function initStructureTest(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:stest",
        description: "临时测试:64/65/100 宽结构捕获上限",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      () => {
        system.run(() => {
          void runTest();
        });
        return {
          status: CustomCommandStatus.Success,
          message: "结构上限测试已启动,结果见内容日志",
        };
      },
    );
  });
}
