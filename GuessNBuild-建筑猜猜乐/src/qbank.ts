import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { QB_KEY } from "./config";

export function loadQuestions(): string[] {
  try {
    const raw = world.getDynamicProperty(QB_KEY);
    if (typeof raw !== "string" || raw.length === 0) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function saveQuestions(list: string[]): void {
  world.setDynamicProperty(QB_KEY, JSON.stringify(list));
}

export function addQuestion(answer: string): "ok" | "empty" | "duplicate" {
  const text = answer.trim();
  if (!text) return "empty";
  const list = loadQuestions();
  if (list.some((q) => q.toLowerCase() === text.toLowerCase())) {
    return "duplicate";
  }
  list.push(text);
  saveQuestions(list);
  return "ok";
}

export function removeQuestion(indexOneBased: number): boolean {
  const list = loadQuestions();
  if (!Number.isInteger(indexOneBased) || indexOneBased < 1 || indexOneBased > list.length) {
    return false;
  }
  list.splice(indexOneBased - 1, 1);
  saveQuestions(list);
  return true;
}

export function clearQuestions(): void {
  saveQuestions([]);
}

function openAdd(player: Player): void {
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "题库 · 添加答案");
  form.label("输入建筑答案(字数提示会自动生成)。");
  form.textField("答案", input);
  form.button("添加", () => {
    form.close();
    const result = addQuestion(input.getData());
    const text =
      result === "ok"
        ? "§a已添加"
        : result === "duplicate"
          ? "§c已存在相同答案"
          : "§c答案不能为空";
    system.runTimeout(() => player.sendMessage(text), 2);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank add", error));
}

function openList(player: Player): void {
  const list = loadQuestions();
  const form = new CustomForm(player, "题库 · 题目列表");
  if (list.length === 0) {
    form.label("题库为空");
  } else {
    form.label(list.map((q, i) => `${i + 1}. ${q}`).join("\n"));
  }
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank list", error));
}

function openDelete(player: Player): void {
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "题库 · 删除答案");
  form.label(`当前题目数:${loadQuestions().length}`);
  form.textField("要删除的序号", input);
  form.button("删除", () => {
    form.close();
    const ok = removeQuestion(Number(input.getData()));
    system.runTimeout(
      () => player.sendMessage(ok ? "§a已删除" : "§c序号无效"),
      2,
    );
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank delete", error));
}

function openClearConfirm(player: Player): void {
  const form = new CustomForm(player, "题库 · 清空确认");
  form.label(`§c将删除全部 ${loadQuestions().length} 道题目,不可恢复。`);
  form.button("确认清空", () => {
    form.close();
    clearQuestions();
    system.runTimeout(() => player.sendMessage("§a题库已清空"), 2);
  });
  form.button("取消", () => {
    form.close();
    system.runTimeout(() => openMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank clear", error));
}

function openMain(player: Player): void {
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.label(`当前题目数:${loadQuestions().length}`);
  form.button("添加答案", () => {
    form.close();
    system.runTimeout(() => openAdd(player), 2);
  });
  form.button("查看题库", () => {
    form.close();
    system.runTimeout(() => openList(player), 2);
  });
  form.button("删除答案", () => {
    form.close();
    system.runTimeout(() => openDelete(player), 2);
  });
  form.button("清空题库", () => {
    form.close();
    system.runTimeout(() => openClearConfirm(player), 2);
  });
  form.show().catch((error) => console.warn("qbank main", error));
}

export function initQBank(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:qbank",
        description: "管理建筑猜猜乐题库(添加/查看/删除/清空)",
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
        system.run(() => openMain(player));
        return {
          status: CustomCommandStatus.Success,
          message: "正在打开题库管理",
        };
      },
    );
  });
}
