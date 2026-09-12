import {
    world,
    TextPrimitive,
    Entity,
    Vector3,
    RGBA,
    Dimension,
} from '@minecraft/server';
import { PREP_SPAWN } from './config';

/** 悬浮文本配置选项 */
interface FloatingTextOptions {
    /** 位置（支持维度定位或纯坐标，仅未绑定实体时生效） */
    location?: Vector3;
    /** 基础文本，可包含变量占位符，如 "{health}" */
    text: string;
    /** 可选：绑定到的实体 */
    entity?: Entity;
    /** 可选：相对于实体或绝对位置的偏移量 */
    offset?: Vector3;
    /** 可选：背景颜色 */
    backgroundColor?: RGBA;
    /** 可选：文字颜色 */
    color?: RGBA;
    /** 可选：是否启用深度测试 */
    depthTest?: boolean;
    /** 可选：最大渲染距离 */
    maxRenderDistance?: number;
}

/**
 * 变量提供函数类型
 * 接收一个可选实体（当前实例绑定的实体），返回变量名到值的映射
 */
type VariableProvider = (entity?: Entity) => Record<string, string | number>;

/** 悬浮文本定义（模板）：由 create 注册，同一 id 可实例化到多个实体 */
interface FloatingTextDefinition {
    baseText: string;
    options: FloatingTextOptions;
    provider?: VariableProvider;
}

/** 悬浮文本实例：一条定义在某个实体（或某个位置）上的一次具体展示 */
interface FloatingTextInstance {
    id: string;
    primitive: TextPrimitive;
    entity?: Entity;
    shown: boolean;
}

/**
 * 悬浮文本管理器
 * 一个 id 对应一条文本定义；每次绑定实体都会生成独立实例：
 * - 同一实体可同时绑定多个不同 id 的悬浮字
 * - 同一 id 可同时绑定到多个实体（各实例独立渲染、独立求值变量）
 */
class FloatingTextManager {
    private definitions: Map<string, FloatingTextDefinition> = new Map();
    /** key 为 `${id}::${entity.id}`，未绑定实体时为 id 本身 */
    private instances: Map<string, FloatingTextInstance> = new Map();
    private dimension: Dimension | undefined;

    /**
     * 初始化悬浮文本管理器
     */
    public initialize(location: Dimension): void {
        this.dimension = location;
    }

    private instanceKey(id: string, entity?: Entity): string {
        return entity ? `${id}::${entity.id}` : id;
    }

    private buildPrimitive(def: FloatingTextDefinition, entity?: Entity): TextPrimitive {
        const options = def.options;
        const primitive = new TextPrimitive(options?.location || PREP_SPAWN, def.baseText);
        if (entity) {
            primitive.attachedTo = entity;
        }
        if (options?.offset) {
            primitive.setLocation(options.offset);
        }
        if (options?.backgroundColor) {
            primitive.backgroundColorOverride = options.backgroundColor;
        }
        if (options?.color) {
            primitive.color = options.color;
        }
        if (options?.depthTest !== undefined) {
            primitive.depthTest = options.depthTest;
        }
        if (options?.maxRenderDistance !== undefined) {
            primitive.maximumRenderDistance = options.maxRenderDistance;
        }
        return primitive;
    }

    /** 根据定义与实例绑定的实体，用变量提供者刷新实例文本 */
    private applyText(instance: FloatingTextInstance): void {
        const def = this.definitions.get(instance.id);
        if (!def?.provider) return;

        const variables = def.provider(instance.entity);
        let finalText = def.baseText;
        for (const [key, value] of Object.entries(variables)) {
            finalText = finalText.replace(
                new RegExp(`\\{${key}\\}`, 'g'),
                String(value)
            );
        }
        instance.primitive.setText(finalText);
    }

    /**
     * 注册一条悬浮文本定义；若 options.entity 存在则同时创建一个绑定该实体的实例
     * 同 id 重复调用会清除旧实例后重建
     * @param id 标识符，同一 id 可通过 bindToEntity 绑定到多个实体
     * @param options 配置选项
     * @param variableProvider 可选，提供变量值的函数（使文本动态化）
     */
    public create(
        id: string,
        options: FloatingTextOptions,
        variableProvider?: VariableProvider
    ): FloatingTextManager {
        this.remove(id);

        const def: FloatingTextDefinition = {
            baseText: options.text,
            options,
            provider: variableProvider,
        };
        this.definitions.set(id, def);

        const instance: FloatingTextInstance = {
            id,
            primitive: this.buildPrimitive(def, options.entity),
            entity: options.entity,
            shown: false,
        };
        this.instances.set(this.instanceKey(id, options.entity), instance);

        if (variableProvider) {
            this.applyText(instance);
        }

        return this;
    }

    /**
     * 将指定 id 的悬浮文本绑定为指定实体上的一个新实例
     * 同一实体可绑定多个不同 id，同一 id 可绑定到多个实体
     * 若该 (id, entity) 组合已存在则仅重新指向，不重复创建
     * @param id 文本标识符
     * @param entity 要绑定的实体
     */
    public bindToEntity(id: string, entity: Entity): void {
        const def = this.definitions.get(id);
        if (!def) {
            console.warn(`FloatingText with id "${id}" not found.`);
            return;
        }

        const key = this.instanceKey(id, entity);
        const existing = this.instances.get(key);
        if (existing) {
            existing.primitive.attachedTo = entity;
            existing.entity = entity;
            this.applyText(existing);
            return;
        }

        const instance: FloatingTextInstance = {
            id,
            primitive: this.buildPrimitive(def, entity),
            entity,
            shown: false,
        };
        this.instances.set(key, instance);
        this.applyText(instance);
    }

    /**
     * 解除指定 id 在指定实体上的绑定（仅移除该实例）
     */
    public unbindFromEntity(id: string, entity: Entity): void {
        const key = this.instanceKey(id, entity);
        const instance = this.instances.get(key);
        if (!instance) return;
        if (instance.shown) {
            world.primitiveShapesManager.removeText(instance.primitive);
        }
        this.instances.delete(key);
    }

    /**
     * 移除某个实体上绑定的所有悬浮文本实例
     */
    public removeForEntity(entity: Entity): void {
        for (const [key, instance] of this.instances) {
            if (instance.entity?.id !== entity.id) continue;
            if (instance.shown) {
                world.primitiveShapesManager.removeText(instance.primitive);
            }
            this.instances.delete(key);
        }
    }

    /**
     * 展示指定 id 的悬浮文本（所有实例）；传入 entity 时仅展示该实体上的实例
     */
    public show(id: string, entity?: Entity): void {
        if (!this.dimension) throw new Error('FloatingTextManager not initialized.');
        for (const instance of this.instances.values()) {
            if (instance.id !== id) continue;
            if (entity && instance.entity?.id !== entity.id) continue;
            if (instance.shown) continue;
            world.primitiveShapesManager.addText(instance.primitive, this.dimension);
            instance.shown = true;
        }
    }

    /**
     * 隐藏指定 id 的悬浮文本（所有实例）但保留实例，可再次 show；
     * 传入 entity 时仅隐藏该实体上的实例
     */
    public hide(id: string, entity?: Entity): void {
        for (const instance of this.instances.values()) {
            if (instance.id !== id) continue;
            if (entity && instance.entity?.id !== entity.id) continue;
            if (!instance.shown) continue;
            world.primitiveShapesManager.removeText(instance.primitive);
            instance.shown = false;
        }
    }

    /**
     * 移除指定 id 的悬浮文本实例（保留定义，之后仍可 bindToEntity 重新绑定）
     * 传入 entity 时仅移除该实体上的实例
     * @param id 文本标识符
     * @param entity 可选，仅移除绑定到该实体的实例
     */
    public remove(id: string, entity?: Entity): void {
        for (const [key, instance] of this.instances) {
            if (instance.id !== id) continue;
            if (entity && instance.entity?.id !== entity.id) continue;
            if (instance.shown) {
                world.primitiveShapesManager.removeText(instance.primitive);
            }
            this.instances.delete(key);
        }
    }

    /**
     * 移除所有悬浮文本的实例
     */
    public removeAll(): void {
        for (const instance of this.instances.values()) {
            if (instance.shown) {
                world.primitiveShapesManager.removeText(instance.primitive);
            }
        }
        this.instances.clear();
    }

    /**
     * 更新指定 id 的悬浮文本内容（每个实例按其绑定的实体独立求值）
     * @param id 文本标识符
     */
    public updateText(id: string): void {
        for (const instance of this.instances.values()) {
            if (instance.id !== id) continue;
            this.applyText(instance);
        }
    }

    /**
     * 更新所有悬浮文本内容
     */
    public updateTextForAll(): void {
        for (const instance of this.instances.values()) {
            this.applyText(instance);
        }
    }

    /**
     * 更新指定 id 的悬浮文本位置（仅适用于未绑定实体的文本）
     * @param id 文本标识符
     * @param newLocation 新位置坐标
     */
    public updatePosition(id: string, newLocation: Vector3): void {
        for (const instance of this.instances.values()) {
            if (instance.id !== id || instance.entity) continue;
            instance.primitive.setLocation(newLocation);
        }
    }

    /**
     * 获取指定 id 当前绑定到的所有实体（供外部对比实际显示与期望显示）
     * @param id 文本标识符
     * @returns 实体数组
     */
    public getBoundEntities(id: string): Entity[] {
        const result: Entity[] = [];
        for (const instance of this.instances.values()) {
            if (instance.id === id && instance.entity) {
                result.push(instance.entity);
            }
        }
        return result;
    }

    /**
     * 获取指定 id 的第一个 TextPrimitive 原始实例（谨慎使用，直接操作可能破坏管理状态）
     * @param id 文本标识符
     * @returns TextPrimitive 实例或 undefined
     */
    public getPrimitive(id: string): TextPrimitive | undefined {
        for (const instance of this.instances.values()) {
            if (instance.id === id) return instance.primitive;
        }
        return undefined;
    }

    /**
     * 获取指定 id 的全部 TextPrimitive 实例（每个绑定实体一个）
     * @param id 文本标识符
     * @returns TextPrimitive 实例数组
     */
    public getPrimitives(id: string): TextPrimitive[] {
        const result: TextPrimitive[] = [];
        for (const instance of this.instances.values()) {
            if (instance.id === id) result.push(instance.primitive);
        }
        return result;
    }
}

export const floatingTextManager = new FloatingTextManager();
