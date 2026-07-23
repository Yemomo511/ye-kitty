import { Tool, type Tool as CanonicalTool } from './tool';

/**
 * 单次运行Tool快照
 *
 * 快照与Registry后续注册变化隔离，保证一次Agent运行看到稳定工具集合。
 */
export class ToolSnapshot {
  /** 只读工具映射 */
  readonly entries: ReadonlyMap<string, CanonicalTool>;

  constructor(entries: ReadonlyMap<string, CanonicalTool>) {
    this.entries = createReadonlyMap(entries);
    Object.freeze(this);
  }

  /**
   * 按名称获取Tool
   * @param name 注册名称
   * @returns 规范Tool
   */
  get(name: string): CanonicalTool | undefined {
    return this.entries.get(name);
  }

  /** 返回稳定名称列表。 */
  names(): readonly string[] {
    return Object.freeze([...this.entries.keys()]);
  }
}

/**
 * 规范Tool注册表
 *
 * Registry是工具名称的唯一真相，只接受Tool.make创建的对象。
 * 它不执行、授权、重试或拼接Prompt。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, CanonicalTool>();

  constructor(initial: Readonly<Record<string, CanonicalTool>> = {}) {
    this.registerMany(initial);
  }

  /**
   * 注册Tool
   * @param name 唯一工具名
   * @param tool 规范Tool
   */
  register(name: string, tool: CanonicalTool): void {
    if (!Tool.is(tool)) throw new Error(`工具 ${name} 不是规范Tool`);
    validateToolName(name);
    if (this.tools.has(name)) throw new Error(`工具名称冲突：${name}`);
    this.tools.set(name, tool);
  }

  /**
   * 批量注册Tool
   * @param tools 名称到Tool映射
   */
  registerMany(tools: Readonly<Record<string, CanonicalTool>>): void {
    for (const [name, tool] of Object.entries(tools)) this.register(name, tool);
  }

  /**
   * 移除Tool
   * @param name 注册名称
   * @returns 是否存在
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 获取Tool
   * @param name 注册名称
   * @returns 规范Tool
   */
  get(name: string): CanonicalTool | undefined {
    return this.tools.get(name);
  }

  /** 创建单次运行快照。 */
  snapshot(): ToolSnapshot {
    return new ToolSnapshot(new Map(this.tools));
  }
}

// 校验OpenAI函数工具名称约束。
function validateToolName(name: string): void {
  if (!name || name.length > 64 || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`工具名称不符合原生函数约束：${name}`);
  }
}

// 使用Proxy阻止Map在运行期被强制转型后修改。
function createReadonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const target = new Map(source);
  return new Proxy(target, {
    get(map, property) {
      if (property === 'set' || property === 'delete' || property === 'clear') {
        return () => {
          throw new Error('Tool快照不可修改');
        };
      }
      const value = Reflect.get(map, property, map) as unknown;
      return typeof value === 'function' ? value.bind(map) : value;
    },
  });
}
