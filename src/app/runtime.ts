import type { AppController } from './controller';
export interface AppRuntime {
  controller: AppController;
  importPackFromFile(uri: string): Promise<void>;
  importSampleCustomPack(): Promise<void>;
  readTextFile(uri: string): Promise<string>;
  saveBackup(contents: string, filename?: string): Promise<string>;
  notices: string[];
}
