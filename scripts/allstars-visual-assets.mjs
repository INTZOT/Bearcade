import { existsSync, unlinkSync } from 'node:fs';

// Shared by import and build, so re-importing props cannot restore the oversized pearl.
export const PROP_SCALES = { pearl: 1.5, command_block: 1.1 };
// Both generated half-alpha and binary-alpha dissolve textures failed visually
// on the target client. Keep the original skins; RC visibility is strictly boolean.
export function useOriginalSkins(root, client) {
  const textures = {};
  for (const skin of ['default', 'blue']) {
    const basePath = client.textures[skin];
    textures[skin] = basePath;
    for (const kind of ['fade', 'dissolve']) for (let level = 0; level < 8; level++) {
      // Exact obsolete generator outputs only; never delete original skins.
      const obsolete = `${root}/resource-pack/${basePath}_${kind}_${level}.png`;
      if (existsSync(obsolete)) unlinkSync(obsolete);
    }
  }
  client.textures = textures;
}
