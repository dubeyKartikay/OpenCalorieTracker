import type { AppController } from './controller';
export interface AppRuntime {
  controller: AppController;
  importPackFromFile(uri: string): Promise<void>;
  importSampleCustomPack(): Promise<void>;
  readTextFile(uri: string): Promise<string>;
  saveBackup(json: string): Promise<string>;
  notices: string[];
}
