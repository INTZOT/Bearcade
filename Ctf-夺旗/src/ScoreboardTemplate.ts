import { RawMessage } from "@minecraft/server";
import { scoreToken, hudMessage } from "..//../shared/minigame-core/scoreboardHud";

type TemplateParam = Map<string, any>;

export class ScoreboardTemplate {
    // 属性1：模板数据 Map<栏目名, { templateStr: string; params: TemplateParam }>
    private columns: Map<string, { templateStr: string; params: TemplateParam }> = new Map();
    // 属性2：模板参数缓存（用于快速比较）
    private paramCache: Map<string, any> = new Map();
    // 属性3：显示状态
    public visible: boolean = true;

    constructor(templateName: string) {
        // 初始化逻辑
    }

    /**
     * 添加栏目（链式调用）
     * @param columnName 栏目名
     * @param templateStr 模板字符串，如 "§l分数: {score}"
     * @param params 默认参数，顺序需与 templateStr 中的占位符一致
     */
    public addColumn(columnName: string, templateStr: string, ...params: any[]): this {
        const paramMap = new Map<string, any>();
        // 按顺序存入参数
        const placeholderMatches = templateStr.match(/\{([^}]+)\}/g) || [];
        placeholderMatches.forEach((placeholder, index) => {
            const key = placeholder.slice(1, -1); // 去除 { 和 }
            paramMap.set(key, params[index] || null);
        });
        this.columns.set(columnName, { templateStr, params: paramMap });
        return this;
    }

    /**
     * 检查缓存是否一致
     */
    public checkCache(): boolean {
        // 比较当前参数与缓存是否一致
        return true; // 具体实现略
    }

    /**
     * 设置模板参数
     */
    public setTemplateParams(columnName: string, params: Map<string, any>): boolean {
        const column = this.columns.get(columnName);
        if (!column) return false;
        column.params = params;
        return true;
    }

    /**
     * 修改模板字符
     */
    public modifyTemplate(columnName: string, newTemplate: string, params?: Map<string, any>): void {
        const column = this.columns.get(columnName);
        if (column) {
            column.templateStr = newTemplate;
            if (params) column.params = params;
        }
    }

    /**
     * 渲染计分板为 RawMessage
     * @param objectiveId 计分板目标 ID
     * @param playerName 玩家名（用于 scoreToken）
     */
    public render(objectiveId: string, playerName: string): RawMessage {
        const parts: RawMessage[] = [];
        for (const [name, { templateStr, params }] of this.columns) {
            // 替换模板中的占位符为 scoreToken
            let rendered = templateStr;
            for (const [key] of params) {
                // 假设所有占位符都对应计分板分数
                rendered = rendered.replace(`{${key}}`, `%${key}%`);
            }
            // 实际应使用 scoreToken 替换
            parts.push({ text: rendered } as RawMessage);
        }
        return hudMessage(parts);
    }
}