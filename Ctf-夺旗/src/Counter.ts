export class Counter {
  private tables: Map<string, Map<string, number>>;

  constructor() {
    this.tables = new Map();
  }

  createTable(tableName: string): void {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, new Map());
    }
  }

  increment(tableName: string, item: string, count: number = 1): void {
    const table = this.tables.get(tableName);
    if (!table) return;
    const current = table.get(item) || 0;
    table.set(item, current + count);
  }

  decrement(tableName: string, item: string, count: number = 1): void {
    const table = this.tables.get(tableName);
    if (!table) return;
    const current = table.get(item) || 0;
    table.set(item, Math.max(0, current - count));
  }

  set(tableName: string, item: string, count: number): void {
    const table = this.tables.get(tableName);
    if (!table) return;
    table.set(item, count);
  }

  get(tableName: string, item: string): number {
    const table = this.tables.get(tableName);
    if (!table) return 0;
    return table.get(item) || 0;
  }

  getTable(tableName: string): Map<string, number> | undefined {
    return this.tables.get(tableName);
  }
}
