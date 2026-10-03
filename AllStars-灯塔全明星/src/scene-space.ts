import type { Vector3 } from "@minecraft/server";
import { ARENA_AXIS, ARENA_CENTER, ARENA_FLOOR_Y, type ArenaAxis } from "./combat-config";

/** Blockbench model units (-Z forward) to Bedrock world units (+Z at yaw 0).
 * The Z reflection also reverses the lateral axis at yaw -90; simply adding
 * model X to world Z mirrors the stage but leaves the kicking pose unmirrored.
 */
export function modelPointToWorld(point: readonly number[], origin: Vector3, yaw: number): Vector3 {
  const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const [x, y, z] = point.map(v => v / 16) as [number, number, number];
  return { x: origin.x + x*c + z*s, y: origin.y + y, z: origin.z + x*s - z*c };
}

export function sceneYaw(facing: number, axis: ArenaAxis = ARENA_AXIS): number {
  return axis === "x" ? (facing > 0 ? -90 : 90) : (facing > 0 ? 0 : 180);
}

export function scenePointToWorld(point: readonly number[], origin: number, facing: number): Vector3 {
  const at = { x: ARENA_CENTER.x, y: ARENA_FLOOR_Y, z: ARENA_CENTER.z };
  at[ARENA_AXIS] += origin;
  return modelPointToWorld(point, at, sceneYaw(facing));
}
