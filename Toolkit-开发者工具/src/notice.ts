// ============================================================
// 悬浮公告管理(移植自 BetterTextDisplay)
// TextPrimitive 持久展示;公告存动态属性,世界加载后自动重建;
// 渲染维度 = 创建公告时执行命令的玩家所在维度(旧数据默认主世界)。
// ============================================================
import {
  system,
  world,
  TextPrimitive,
  type Player,
} from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
} from "@minecraft/server-ui";

const DEFAULT_DIMENSION_ID = "minecraft:overworld";
const NOTICE_LIST_KEY = "notice:list"; // 与旧公告数据共用,迁移无缝
const LINE_SPACING = 0.4; // 多行公告行间距
const SELF_HEAL_INTERVAL_TICKS = 200; // 每 10 秒全量重渲染自愈(维度加载/异常兜底)

interface NoticeEntry {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  colorIndex: number;
  background: boolean;
  bgAlpha: number;
  billboard: boolean;
  rotationY: number;
  dimensionId?: string;
}

const COLOR_PRESETS = [
  { name: "白色", rgb: { red: 1, green: 1, blue: 1 } },
  { name: "金色", rgb: { red: 1, green: 0.85, blue: 0.2 } },
  { name: "青色", rgb: { red: 0.55, green: 0.85, blue: 1 } },
  { name: "红色", rgb: { red: 1, green: 0.4, blue: 0.4 } },
  { name: "绿色", rgb: { red: 0.55, green: 1, blue: 0.55 } },
  { name: "黄色", rgb: { red: 1, green: 1, blue: 0.55 } },
  { name: "粉色", rgb: { red: 1, green: 0.55, blue: 0.75 } },
  { name: "紫色", rgb: { red: 0.75, green: 0.55, blue: 1 } },
];

// id -> TextPrimitive[]
const noticeShapes = new Map<string, TextPrimitive[]>();

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 旧公告数据兼容:逐字段校验并补齐缺省值,非法条目丢弃,避免脏数据导致渲染异常 */
function normalizeNotice(item: unknown): NoticeEntry | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const raw = item as Partial<NoticeEntry>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return undefined;
  const text = raw.text ?? "";
  return {
    id: raw.id,
    text: typeof text === "string" ? text : String(text),
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 0),
    z: finiteNumber(raw.z, 0),
    scale: finiteNumber(raw.scale, 1),
    colorIndex:
      typeof raw.colorIndex === "number" && Number.isInteger(raw.colorIndex)
        ? raw.colorIndex
        : 0,
    background: typeof raw.background === "boolean" ? raw.background : true,
    bgAlpha: finiteNumber(raw.bgAlpha, 0.45),
    billboard: typeof raw.billboard === "boolean" ? raw.billboard : true,
    rotationY: finiteNumber(raw.rotationY, 0),
    dimensionId:
      typeof raw.dimensionId === "string" ? raw.dimensionId : undefined,
  };
}

function getNotices(): NoticeEntry[] {
  const raw = world.getDynamicProperty(NOTICE_LIST_KEY);
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const entry = normalizeNotice(item);
      return entry ? [entry] : [];
    });
  } catch {
    return [];
  }
}

function saveNotices(list: NoticeEntry[]): void {
  world.setDynamicProperty(NOTICE_LIST_KEY, JSON.stringify(list));
}

function clearShapes(id: string): void {
  const shapes = noticeShapes.get(id);
  if (!shapes) return;
  for (const shape of shapes) {
    try {
      world.primitiveShapesManager.removeText(shape);
    } catch {
      // 形状可能已不存在
    }
  }
  noticeShapes.delete(id);
}

function renderNotice(entry: NoticeEntry): void {
  clearShapes(entry.id);
  let lobby;
  try {
    lobby = world.getDimension(entry.dimensionId ?? DEFAULT_DIMENSION_ID);
  } catch (error) {
    console.warn(`[Toolkit] 公告 #${entry.id} 维度不存在:${entry.dimensionId}`);
    return;
  }
  // 兼容字面 \n(从输入框粘贴的复制版)与真实换行
  const lines = String(entry.text || "").replace(/\\n/g, "\n").split("\n");
  const shapes: TextPrimitive[] = [];
  const color = {
    ...(COLOR_PRESETS[entry.colorIndex]?.rgb || COLOR_PRESETS[0].rgb),
    alpha: 1,
  };

  lines.forEach((line, i) => {
    try {
      const shape = new TextPrimitive(
        {
          x: entry.x,
          y: entry.y - i * LINE_SPACING,
          z: entry.z,
          dimension: lobby,
        },
        line,
      );
      shape.scale = entry.scale ?? 1;
      shape.color = color;
      shape.backgroundColorOverride = entry.background
        ? { red: 0, green: 0, blue: 0, alpha: entry.bgAlpha ?? 0.45 }
        : { red: 0, green: 0, blue: 0, alpha: 0 };
      shape.depthTest = false;
      if (!entry.billboard) {
        shape.useRotation = true;
        shape.rotation = { x: 0, y: entry.rotationY ?? 0, z: 0 };
      }
      world.primitiveShapesManager.addText(shape, lobby);
      shapes.push(shape);
    } catch (error) {
      console.warn(`[Toolkit] 公告渲染失败 ${entry.id}: ${error}`);
    }
  });
  noticeShapes.set(entry.id, shapes);
}

function renderAllNotices(): void {
  for (const id of [...noticeShapes.keys()]) clearShapes(id);
  for (const notice of getNotices()) renderNotice(notice);
}

export function initNotice(): void {
  world.afterEvents.worldLoad.subscribe(() => {
    system.runTimeout(renderAllNotices, 20);
  });
  // 自愈:自定义维度可能尚未加载,定期全量重渲染(清旧再建,不会重复)
  system.runInterval(renderAllNotices, SELF_HEAL_INTERVAL_TICKS);
}

// ============================================================
// 管理界面
// ============================================================

export function showNoticeAdminMenu(player: Player, backFn: () => void = () => {}): void {
  const notices = getNotices();
  const form = new CustomForm(player, "公告管理");
  form.label(`§6当前公告:${notices.length}`);
  form.spacer();

  const items = notices.map((n, i) => ({
    label: `#${n.id}  ${n.text}  (${Math.round(n.x)}, ${Math.round(n.y)}, ${Math.round(n.z)})`,
    value: i,
  }));
  items.push({ label: "＋ 新建公告", value: notices.length });
  const selected = new ObservableNumber(0, { clientWritable: true });

  form.dropdown("选择公告", selected, items);
  form.spacer();
  form.button("编辑", () => {
    const idx = selected.getData();
    form.close();
    if (idx >= notices.length) {
      system.runTimeout(() => showNoticeEditor(player, null, backFn), 2);
    } else {
      system.runTimeout(() => showNoticeEditor(player, notices[idx], backFn), 2);
    }
  });
  form.spacer();
  form.button("删除", () => {
    const idx = selected.getData();
    if (idx >= notices.length) {
      player.sendMessage("§c请先选择要删除的公告");
      return;
    }
    const target = notices[idx];
    const list = getNotices().filter((x) => x.id !== target.id);
    saveNotices(list);
    clearShapes(target.id);
    player.sendMessage(`§a已删除公告 #${target.id}`);
    player.playSound("random.orb");
    form.close();
    system.runTimeout(() => showNoticeAdminMenu(player, backFn), 2);
  });

  form.spacer().button("关闭", () => form.close());
  form.show().catch((e) => console.warn("Notice admin form failed:", e));
}

function showNoticeEditor(
  player: Player,
  notice: NoticeEntry | null,
  backFn: () => void,
): void {
  const textObs = new ObservableString(notice?.text ?? "", {
    clientWritable: true,
  });
  const xObs = new ObservableString(
    notice ? String(notice.x) : String(Math.round(player.location.x * 100) / 100),
    { clientWritable: true },
  );
  const yObs = new ObservableString(
    notice ? String(notice.y) : String(Math.round(player.location.y * 100) / 100),
    { clientWritable: true },
  );
  const zObs = new ObservableString(
    notice ? String(notice.z) : String(Math.round(player.location.z * 100) / 100),
    { clientWritable: true },
  );
  const scaleObs = new ObservableNumber(notice?.scale ?? 1, {
    clientWritable: true,
  });
  const colorObs = new ObservableNumber(notice?.colorIndex ?? 0, {
    clientWritable: true,
  });
  const bgObs = new ObservableBoolean(notice?.background ?? true, {
    clientWritable: true,
  });
  const bgAlphaObs = new ObservableNumber(
    notice ? Math.round((notice.bgAlpha ?? 0.45) * 100) : 45,
    { clientWritable: true },
  );
  const billboardObs = new ObservableBoolean(notice?.billboard ?? true, {
    clientWritable: true,
  });
  const yawObs = new ObservableString(
    notice
      ? String(notice.rotationY ?? 0)
      : String(Math.round(player.getRotation().y)),
    { clientWritable: true },
  );

  const form = new CustomForm(player, notice ? `编辑公告 #${notice.id}` : "新建公告");
  form
    .textField("内容", textObs)
    .spacer()
    .textField("X 坐标", xObs)
    .textField("Y 坐标", yObs)
    .textField("Z 坐标", zObs)
    .spacer()
    .slider("缩放", scaleObs, new ObservableNumber(0.5), new ObservableNumber(5), {
      step: 0.1,
    })
    .spacer()
    .dropdown(
      "颜色",
      colorObs,
      COLOR_PRESETS.map((c, i) => ({ label: c.name, value: i })),
    )
    .spacer()
    .toggle("显示背景", bgObs)
    .slider(
      "背景透明度 (%)",
      bgAlphaObs,
      new ObservableNumber(0),
      new ObservableNumber(100),
      { step: 5 },
    )
    .toggle("跟随镜头(关闭则固定朝向)", billboardObs)
    .textField("旋转角度 Yaw(固定朝向时生效)", yawObs)
    .spacer()
    .button("保存", () => {
      const text = textObs.getData().trim();
      if (!text) {
        player.sendMessage("§c公告内容不能为空");
        form.close();
        system.runTimeout(() => showNoticeEditor(player, notice, backFn), 2);
        return;
      }
      const x = Number(xObs.getData());
      const y = Number(yObs.getData());
      const z = Number(zObs.getData());
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        player.sendMessage("§c坐标必须为数字");
        form.close();
        system.runTimeout(() => showNoticeEditor(player, notice, backFn), 2);
        return;
      }
      const yaw = Number(yawObs.getData());
      if (!Number.isFinite(yaw)) {
        player.sendMessage("§c旋转角度必须为数字");
        form.close();
        system.runTimeout(() => showNoticeEditor(player, notice, backFn), 2);
        return;
      }

      const id = notice?.id ?? `n${Date.now()}`;
      const list = getNotices().filter((n) => n.id !== id);
      const entry: NoticeEntry = {
        id,
        text,
        x,
        y,
        z,
        scale: scaleObs.getData(),
        colorIndex: colorObs.getData(),
        background: bgObs.getData(),
        bgAlpha: bgAlphaObs.getData() / 100,
        billboard: billboardObs.getData(),
        rotationY: billboardObs.getData() ? 0 : yaw,
        // 公告维度 = 当前执行命令玩家所在维度(新建时);编辑保留原维度
        dimensionId: notice?.dimensionId ?? player.dimension.id,
      };
      list.push(entry);
      saveNotices(list);
      renderNotice(entry);
      player.sendMessage(`§a公告${notice ? "已更新" : "已创建"} #${id}`);
      player.playSound("random.orb");
      form.close();
      system.runTimeout(() => showNoticeAdminMenu(player, backFn), 2);
    })
    .spacer()
    .button("取消", () => {
      form.close();
      system.runTimeout(() => showNoticeAdminMenu(player, backFn), 2);
    });

  form.show().catch((e) => console.warn("Notice editor form failed:", e));
}
