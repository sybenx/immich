import { EntityManager } from 'typeorm';
import { Version } from '../domain.constant';

export enum DatabaseExtension {
  CUBE = 'cube',
  EARTH_DISTANCE = 'earthdistance',
  VECTOR = 'vector',
  VECTORS = 'vectors',
}

export enum DatabaseLock {
  GeodataImport = 100,
  StorageTemplateMigration = 420,
  CLIPDimSize = 512,
}

export const IDatabaseRepository = 'IDatabaseRepository';

export interface IDatabaseRepository {
  getExtensionVersion(extName: string): Promise<Version | null>;
  getPostgresVersion(): Promise<Version>;
  createExtension(extension: DatabaseExtension): Promise<void>;
  createCLIPIndex(manager: EntityManager): Promise<void>;
  createFaceIndex(manager: EntityManager): Promise<void>;
  updateCLIPDimSize(dimSize: number): Promise<void>;
  getCLIPDimSize(): Promise<number>;
  runMigrations(options?: { transaction?: 'all' | 'none' | 'each' }): Promise<void>;
  withLock<R>(lock: DatabaseLock, callback: () => Promise<R>): Promise<R>;
  isBusy(lock: DatabaseLock): boolean;
  wait(lock: DatabaseLock): Promise<void>;
}
