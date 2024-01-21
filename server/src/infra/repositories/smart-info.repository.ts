import {
  DatabaseExtension,
  Embedding,
  EmbeddingSearch,
  FaceEmbeddingSearch,
  FaceSearchResult,
  ISmartInfoRepository,
} from '@app/domain';
import { AssetEntity, AssetFaceEntity, SmartInfoEntity, SmartSearchEntity } from '@app/infra/entities';
import { ImmichLogger } from '@app/infra/logger';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { vectorExtension } from '..';
import { DummyValue, GenerateSql } from '../infra.util';
import { asVector, isValidInteger } from '../infra.utils';

@Injectable()
export class SmartInfoRepository implements ISmartInfoRepository {
  private logger = new ImmichLogger(SmartInfoRepository.name);
  private faceColumns: string[];

  constructor(
    @InjectRepository(SmartInfoEntity) private repository: Repository<SmartInfoEntity>,
    @InjectRepository(AssetEntity) private assetRepository: Repository<AssetEntity>,
    @InjectRepository(AssetFaceEntity) private assetFaceRepository: Repository<AssetFaceEntity>,
    @InjectRepository(SmartSearchEntity) private smartSearchRepository: Repository<SmartSearchEntity>,
  ) {
    this.faceColumns = this.assetFaceRepository.manager.connection
      .getMetadata(AssetFaceEntity)
      .ownColumns.map((column) => column.propertyName)
      .filter((propertyName) => propertyName !== 'embedding');
  }

  @GenerateSql({
    params: [{ userIds: [DummyValue.UUID], embedding: Array.from({ length: 512 }, Math.random), numResults: 100 }],
  })
  async searchCLIP({ userIds, embedding, numResults, withArchived }: EmbeddingSearch): Promise<AssetEntity[]> {
    if (numResults != null && !isValidInteger(numResults, { min: 1 })) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    let results: AssetEntity[] = [];
    await this.assetRepository.manager.transaction(async (manager) => {
      let query = manager
        .createQueryBuilder(AssetEntity, 'a')
        .innerJoin('a.smartSearch', 's')
        .leftJoinAndSelect('a.exifInfo', 'e')
        .where('a.ownerId IN (:...userIds )')
        .orderBy('s.embedding <=> :embedding')
        .setParameters({ userIds, embedding: asVector(embedding) });

      if (!withArchived) {
        query.andWhere('a.isArchived = false');
      }
      query.andWhere('a.isVisible = true').andWhere('a.fileCreatedAt < NOW()');
      if (numResults) {
        query.limit(numResults);
      }

      await manager.query(this.getRuntimeConfig(numResults));
      results = await query.getMany();
    });

    return results;
  }

  @GenerateSql({
    params: [
      {
        userIds: [DummyValue.UUID],
        embedding: Array.from({ length: 512 }, Math.random),
        numResults: 100,
        maxDistance: 0.6,
      },
    ],
  })
  async searchFaces({
    userIds,
    embedding,
    numResults,
    maxDistance,
    hasPerson,
  }: FaceEmbeddingSearch): Promise<FaceSearchResult[]> {
    let results: Array<AssetFaceEntity & { distance: number }> = [];
    await this.assetRepository.manager.transaction(async (manager) => {
      let cte = manager
        .createQueryBuilder(AssetFaceEntity, 'faces')
        .select('faces.embedding <=> :embedding', 'distance')
        .innerJoin('faces.asset', 'asset')
        .where('asset.ownerId IN (:...userIds )')
        .orderBy('faces.embedding <=> :embedding')
        .setParameters({ userIds, embedding: asVector(embedding) });

      let runtimeConfig = 'SET LOCAL vectors.enable_prefilter=on; SET LOCAL vectors.search_mode=basic;';
      if (numResults) {
        if (!isValidInteger(numResults, { min: 1 })) {
          throw new Error(`Invalid value for 'numResults': ${numResults}`);
        }
        const limit = Math.max(numResults, 64);
        cte = cte.limit(limit);
        // setting this too low messes with prefilter recall
        runtimeConfig += ` SET LOCAL vectors.hnsw_ef_search = ${limit}`;
      }

      if (hasPerson) {
        cte = cte.andWhere('faces."personId" IS NOT NULL');
      }

      this.faceColumns.forEach((col) => cte.addSelect(`faces.${col}`, col));

      await manager.query(runtimeConfig);
      results = await manager
        .createQueryBuilder()
        .select('res.*')
        .addCommonTableExpression(cte, 'cte')
        .from('cte', 'res')
        .where('res.distance <= :maxDistance', { maxDistance })
        .getRawMany();
    });

    return results.map((row) => ({
      face: this.assetFaceRepository.create(row),
      distance: row.distance,
    }));
  }

  async upsert(smartInfo: Partial<SmartInfoEntity>, embedding?: Embedding): Promise<void> {
    await this.repository.upsert(smartInfo, { conflictPaths: ['assetId'] });
    if (!smartInfo.assetId || !embedding) {
      return;
    }

    await this.upsertEmbedding(smartInfo.assetId, embedding);
  }

  private async upsertEmbedding(assetId: string, embedding: number[]): Promise<void> {
    await this.smartSearchRepository.upsert(
      { assetId, embedding: () => asVector(embedding, true) },
      { conflictPaths: ['assetId'] },
    );
  }

  private getRuntimeConfig(numResults?: number): string {
    let runtimeConfig = '';
    if (vectorExtension === DatabaseExtension.VECTORS) {
      runtimeConfig = 'SET LOCAL vectors.enable_prefilter=on; SET LOCAL vectors.search_mode=basic;';
      if (numResults) {
        runtimeConfig += ` SET LOCAL vectors.hnsw_ef_search = ${numResults}`;
      }
    } else if (vectorExtension === DatabaseExtension.VECTOR) {
      runtimeConfig = 'SET LOCAL hnsw.ef_search = 1000;'; // mitigate post-filter recall
    }

    return runtimeConfig;
  }
}
