import { createWriteStream } from "node:fs";
import { ZipArchive } from "archiver";

/**
 * 跨平台 zip 打包:把 srcDir 目录内容压缩到 destZipPath。
 * 替代 Windows PowerShell Compress-Archive,可在 Linux/macOS(含 CI)使用。
 */
export function zipDirectory(srcDir, destZipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    void archive.finalize();
  });
}
