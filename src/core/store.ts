// 极简响应式 store：subscribe + 版本号，配合路由做整页重渲染
import { storage } from './storage';
import { createSampleProject, defaultSettings } from './defaults';
import { clone, uid } from './id';
import type { AppSettings, Project } from './types';

type Listener = () => void;

class AppStore {
  projects: Project[] = [];
  settings: AppSettings = defaultSettings();
  currentId: string | null = null;
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async init(): Promise<void> {
    const [rows, saved] = await Promise.all([
      storage.listProjects(),
      storage.loadSettings<AppSettings>(),
    ]);
    this.projects = rows as Project[];
    if (this.projects.length === 0) {
      const sample = createSampleProject();
      this.projects = [sample];
      await storage.putProject(sample);
    }
    if (saved && Array.isArray(saved.gritTable) && saved.gritTable.length > 0) {
      this.settings = saved;
    } else {
      this.settings = defaultSettings();
      await storage.saveSettings(this.settings);
    }
    this.currentId = this.projects[0]?.id ?? null;
    this.emit();
  }

  get current(): Project | null {
    return this.projects.find((p) => p.id === this.currentId) ?? null;
  }

  select(id: string): void {
    this.currentId = id;
    this.emit();
  }

  async createProject(): Promise<Project> {
    const p = createSampleProject();
    p.name = `新项目 ${this.projects.length + 1}`;
    p.id = uid('prj');
    this.projects = [...this.projects, p];
    this.currentId = p.id;
    await storage.putProject(p);
    this.emit();
    return p;
  }

  async duplicateProject(id: string): Promise<void> {
    const src = this.projects.find((p) => p.id === id);
    if (!src) return;
    const copy = clone(src);
    copy.id = uid('prj');
    copy.name = `${src.name}（副本）`;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    this.projects = [...this.projects, copy];
    await storage.putProject(copy);
    this.emit();
  }

  async deleteProject(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.currentId === id) this.currentId = this.projects[0]?.id ?? null;
    await storage.deleteProject(id);
    this.emit();
  }

  /** 局部修改当前项目，防抖落库 */
  updateCurrent(mutator: (p: Project) => void): void {
    const p = this.current;
    if (!p) return;
    mutator(p);
    p.updatedAt = Date.now();
    this.emit();
    this.scheduleSave();
  }

  updateSettings(mutator: (s: AppSettings) => void): void {
    mutator(this.settings);
    this.emit();
    this.scheduleSaveSettings();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const p = this.current;
      if (p) void storage.putProject(p);
    }, 400);
  }

  private scheduleSaveSettings(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void storage.saveSettings(this.settings);
    }, 400);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await Promise.all([
      this.current ? storage.putProject(this.current) : Promise.resolve(),
      storage.saveSettings(this.settings),
    ]);
  }
}

export const store = new AppStore();
