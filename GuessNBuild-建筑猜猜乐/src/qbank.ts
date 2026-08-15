import {
  system,
  world,
  type Player,
} from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { QB_KEY } from "./config";

const PAGE_SIZE = 6;

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
  if (
    !Number.isInteger(indexOneBased) ||
    indexOneBased < 1 ||
    indexOneBased > list.length
  ) {
    return false;
  }
  list.splice(indexOneBased - 1, 1);
  saveQuestions(list);
  return true;
}

export function clearQuestions(): void {
  saveQuestions([]);
}

type PageOpener = (player: Player, page: number) => void;

function totalPages(): number {
  return Math.max(1, Math.ceil(loadQuestions().length / PAGE_SIZE));
}

function addPageNav(
  form: CustomForm,
  player: Player,
  page: number,
  opener: PageOpener,
): void {
  form.spacer();
  if (page > 0) {
    form.button("上一页", () => {
      form.close();
      system.runTimeout(() => opener(player, page - 1), 2);
    });
  }
  if (page < totalPages() - 1) {
    form.button("下一页", () => {
      form.close();
      system.runTimeout(() => opener(player, page + 1), 2);
    });
  }
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openQBankMain(player), 2);
  });
}

function openAdd(player: Player): void {
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.header("添加答案");
  form.spacer();
  form.label("输入建筑答案,字数提示会自动生成。");
  form.spacer();
  form.textField("答案", input);
  form.spacer();
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
    system.runTimeout(() => openQBankMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank add", error));
}

function openList(player: Player, page = 0): void {
  const list = loadQuestions();
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.header(`查看题库(${list.length})`);
  form.spacer();
  if (list.length === 0) {
    form.label("题库为空");
  } else {
    const start = page * PAGE_SIZE;
    const slice = list.slice(start, start + PAGE_SIZE);
    for (const [index, question] of slice.entries()) {
      form.label(`${start + index + 1}. ${question}`);
      form.spacer();
    }
  }
  addPageNav(form, player, page, openList);
  form.show().catch((error) => console.warn("qbank list", error));
}

function openDelete(player: Player, page = 0): void {
  const list = loadQuestions();
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.header(`删除答案(${list.length})`);
  form.spacer();
  if (list.length === 0) {
    form.label("题库为空");
  } else {
    const start = page * PAGE_SIZE;
    const slice = list.slice(start, start + PAGE_SIZE);
    for (const [index, question] of slice.entries()) {
      form.label(`${start + index + 1}. ${question}`);
      form.spacer();
    }
    form.textField("要删除的序号", input);
    form.button("删除", () => {
      form.close();
      const ok = removeQuestion(Number(input.getData()));
      system.runTimeout(
        () => player.sendMessage(ok ? "§a已删除" : "§c序号无效"),
        2,
      );
    });
  }
  addPageNav(form, player, page, openDelete);
  form.show().catch((error) => console.warn("qbank delete", error));
}

function openClearConfirm(player: Player): void {
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.header("清空题库");
  form.spacer();
  form.label(`§c将删除全部 ${loadQuestions().length} 道题目,不可恢复。`);
  form.spacer();
  form.button("确认清空", () => {
    form.close();
    clearQuestions();
    system.runTimeout(() => player.sendMessage("§a题库已清空"), 2);
  });
  form.button("取消", () => {
    form.close();
    system.runTimeout(() => openQBankMain(player), 2);
  });
  form.show().catch((error) => console.warn("qbank clear", error));
}

export function openQBankMain(player: Player): void {
  const form = new CustomForm(player, "建筑猜猜乐 · 题库管理");
  form.header("题库管理");
  form.spacer();
  form.label(`当前题目数:${loadQuestions().length}`);
  form.divider();
  form.button("添加答案", () => {
    form.close();
    system.runTimeout(() => openAdd(player), 2);
  });
  form.button("查看题库", () => {
    form.close();
    system.runTimeout(() => openList(player, 0), 2);
  });
  form.button("删除答案", () => {
    form.close();
    system.runTimeout(() => openDelete(player, 0), 2);
  });
  form.button("清空题库", () => {
    form.close();
    system.runTimeout(() => openClearConfirm(player), 2);
  });
  form.divider();
  form.button("关闭", () => {
    form.close();
  });
  form.show().catch((error) => console.warn("qbank main", error));
}
