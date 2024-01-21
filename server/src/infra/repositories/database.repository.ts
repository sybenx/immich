import { DatabaseExtension, DatabaseLock, IDatabaseRepository, Version } from '@app/domain';
import { getCLIPModelInfo } from '@app/domain/smart-info/smart-info.constant';
import { vectorExtension } from '@app/infra/database.config';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import AsyncLock from 'async-lock';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { isValidInteger } from '../infra.utils';
import { ImmichLogger } from '../logger';

@Injectable()
export class DatabaseRepository implements IDatabaseRepository {
  private logger = new ImmichLogger(DatabaseRepository.name);
  readonly asyncLock = new AsyncLock();

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getExtensionVersion(extension: DatabaseExtension): Promise<Version | null> {
    const res = await this.dataSource.query(`SELECT extversion FROM pg_extension WHERE extname = $1`, [extension]);
    const version = res[0]?.['extversion'];
    return version == null ? null : Version.fromString(version);
  }

  async getPostgresVersion(): Promise<Version> {
    const res = await this.dataSource.query(`SHOW server_version`);
    return Version.fromString(res[0]['server_version']);
  }

  async createExtension(extension: DatabaseExtension): Promise<void> {
    await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
    if ([DatabaseExtension.VECTOR, DatabaseExtension.VECTORS].includes(extension)) {
      await this.vectorExtensionDown();
      await this.vectorExtensionUp();
    }
  }

  private async vectorExtensionUp(): Promise<void> {
    const clipModelNameQuery = await this.dataSource.query(
      `SELECT value FROM system_config WHERE key = 'machineLearning.clip.modelName'`,
    );
    const clipModelName: string = clipModelNameQuery?.[0]?.['value'] ?? 'ViT-B-32__openai';
    const clipDimSize = getCLIPModelInfo(clipModelName.replace(/"/g, '')).dimSize;

    const faceDimQuery = await this.dataSource.query(`
      SELECT CARDINALITY(embedding::real[]) as dimsize
      FROM asset_faces
      LIMIT 1`);
    const faceDimSize = faceDimQuery?.[0]?.['dimsize'] ?? 512;

    await this.dataSource.manager.transaction(async (manager) => {
      await manager.query(`SET vectors.pgvector_compatibility=on`);
      await manager.query(`
        ALTER TABLE asset_faces
        ALTER COLUMN embedding TYPE vector(${faceDimSize})`);
      await manager.query(`
        ALTER TABLE smart_search
        ALTER COLUMN embedding TYPE vector(${clipDimSize})`);

      await this.createFaceIndex(manager);
      await this.createCLIPIndex(manager);
    });
  }

  private async vectorExtensionDown(): Promise<void> {
    await this.dataSource.manager.transaction(async (manager) => {
      await manager.query(`SET vectors.pgvector_compatibility=on`);
      await manager.query('DROP INDEX IF EXISTS face_index');
      await manager.query('DROP INDEX IF EXISTS clip_index');

      await manager.query('ALTER TABLE asset_faces ALTER COLUMN embedding TYPE real array');
      await manager.query('ALTER TABLE smart_search ALTER COLUMN embedding TYPE real array');
    })
  };

  async createCLIPIndex(manager: EntityManager): Promise<void> {
    if (vectorExtension === DatabaseExtension.VECTORS) {
      await manager.query(`SET vectors.pgvector_compatibility=on`);
    }

    await manager.query(`
      CREATE INDEX IF NOT EXISTS clip_index ON smart_search
      USING hnsw (embedding vector_cosine_ops)
      WITH (ef_construction = 300, m = 16)`);
  }

  async createFaceIndex(manager: EntityManager): Promise<void> {
    if (vectorExtension === DatabaseExtension.VECTORS) {
      await manager.query(`SET vectors.pgvector_compatibility=on`);
    }

    await manager.query(`
      CREATE INDEX IF NOT EXISTS face_index ON asset_faces
      USING hnsw (embedding vector_cosine_ops)
      WITH (ef_construction = 300, m = 16)`);
  }

  async updateCLIPDimSize(dimSize: number): Promise<void> {
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
      throw new Error(`Invalid CLIP dimension size: ${dimSize}`);
    }

    const curDimSize = await this.getCLIPDimSize();
    if (curDimSize === dimSize) {
      return;
    }

    this.logger.log(`Updating database CLIP dimension size to ${dimSize}.`);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DROP TABLE smart_search`);

      await manager.query(`
          CREATE TABLE smart_search (
            "assetId"  uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
            embedding  ${vectorExtension}.vector(${dimSize}) NOT NULL )`);

      this.createCLIPIndex(manager);
    });

    this.logger.log(`Successfully updated database CLIP dimension size from ${curDimSize} to ${dimSize}.`);
  }

  async getCLIPDimSize(): Promise<number> {
    const res = await this.dataSource.query(`
      SELECT atttypmod as dimsize
      FROM pg_attribute f
        JOIN pg_class c ON c.oid = f.attrelid
      WHERE c.relkind = 'r'::char
        AND f.attnum > 0
        AND c.relname = 'smart_search'
        AND f.attname = 'embedding'`);

    const dimSize = res[0]['dimsize'];
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
      throw new Error(`Could not retrieve CLIP dimension size`);
    }
    return dimSize;
  }

  async runMigrations(options?: { transaction?: 'all' | 'none' | 'each' }): Promise<void> {
    await this.dataSource.runMigrations(options);
  }

  async withLock<R>(lock: DatabaseLock, callback: () => Promise<R>): Promise<R> {
    let res;
    await this.asyncLock.acquire(DatabaseLock[lock], async () => {
      const queryRunner = this.dataSource.createQueryRunner();
      try {
        await this.acquireLock(lock, queryRunner);
        res = await callback();
      } finally {
        try {
          await this.releaseLock(lock, queryRunner);
        } finally {
          await queryRunner.release();
        }
      }
    });

    return res as R;
  }

  isBusy(lock: DatabaseLock): boolean {
    return this.asyncLock.isBusy(DatabaseLock[lock]);
  }

  async wait(lock: DatabaseLock): Promise<void> {
    await this.asyncLock.acquire(DatabaseLock[lock], () => {});
  }

  private async acquireLock(lock: DatabaseLock, queryRunner: QueryRunner): Promise<void> {
    return queryRunner.query('SELECT pg_advisory_lock($1)', [lock]);
  }

  private async releaseLock(lock: DatabaseLock, queryRunner: QueryRunner): Promise<void> {
    return queryRunner.query('SELECT pg_advisory_unlock($1)', [lock]);
  }
}
