import { AssetEntity, AssetFaceEntity, AssetType, SmartInfoEntity } from '@app/infra/entities';
import { Paginated } from '../domain.util';

export const ISearchRepository = 'ISearchRepository';

export enum SearchStrategy {
  CLIP = 'CLIP',
  TEXT = 'TEXT',
}

export interface SearchFilter {
  id?: string;
  userId: string;
  type?: AssetType;
  isFavorite?: boolean;
  isArchived?: boolean;
  city?: string;
  state?: string;
  country?: string;
  make?: string;
  model?: string;
  objects?: string[];
  tags?: string[];
  recent?: boolean;
  motion?: boolean;
  debug?: boolean;
}

export interface SearchResult<T> {
  /** total matches */
  total: number;
  /** collection size */
  count: number;
  /** current page */
  page: number;
  /** items for page */
  items: T[];
  /** score */
  distances: number[];
  facets: SearchFacet[];
}

export interface SearchFacet {
  fieldName: string;
  counts: Array<{
    count: number;
    value: string;
  }>;
}

export type SearchExploreItemSet<T> = Array<{
  value: string;
  data: T;
}>;

export interface SearchExploreItem<T> {
  fieldName: string;
  items: SearchExploreItemSet<T>;
}

export type Embedding = number[];

export interface SearchIDOptions {
  checksum?: Buffer;
  deviceAssetId?: string;
  deviceId?: string;
  id?: string;
  libraryId?: string;
  ownerId?: string;
}

export interface SearchStatusOptions {
  isArchived?: boolean;
  isEncoded?: boolean;
  isExternal?: boolean;
  isFavorite?: boolean;
  isMotion?: boolean;
  isOffline?: boolean;
  isReadOnly?: boolean;
  isVisible?: boolean;
  type?: AssetType;
  withArchived?: boolean;
  withDeleted?: boolean;
}

export interface SearchOneToOneRelationOptions {
  withExif?: boolean;
  withSmartInfo?: boolean;
}

export interface SearchRelationOptions extends SearchOneToOneRelationOptions {
  withFaces?: boolean;
  withPeople?: boolean;
  withStacked?: boolean;
}

export interface SearchDateOptions {
  createdBefore?: Date;
  createdAfter?: Date;
  takenBefore?: Date;
  takenAfter?: Date;
  trashedBefore?: Date;
  trashedAfter?: Date;
  updatedBefore?: Date;
  updatedAfter?: Date;
}

export interface SearchPathOptions {
  encodedVideoPath?: string;
  originalFileName?: string;
  originalPath?: string;
  resizePath?: string;
  webpPath?: string;
}

export interface SearchExifOptions {
  city?: string;
  country?: string;
  lensModel?: string;
  make?: string;
  model?: string;
  state?: string;
}

export interface SearchEmbeddingOptions {
  embedding: Embedding;
  userIds: string[];
}

export interface SearchOrderOptions {
  direction: 'ASC' | 'DESC';
}

export interface SearchPaginationOptions {
  page: number;
  size: number;
}

export interface AssetSearchOptions {
  date?: SearchDateOptions;
  id?: SearchIDOptions;
  exif?: SearchExifOptions;
  order?: SearchOrderOptions;
  path?: SearchPathOptions;
  relation?: SearchRelationOptions;
  status?: SearchStatusOptions;
}

export type AssetSearchBuilderOptions = Omit<AssetSearchOptions, 'order'>;

export interface SmartSearchOptions extends SearchEmbeddingOptions {
  date?: SearchDateOptions;
  exif?: SearchExifOptions;
  relation?: SearchRelationOptions;
  status?: SearchStatusOptions;
}

export interface FaceEmbeddingSearch extends SearchEmbeddingOptions {
  hasPerson?: boolean;
  numResults?: number;
  maxDistance?: number;
}

export interface FaceSearchResult {
  distance: number;
  face: AssetFaceEntity;
}

export interface ISearchRepository {
  init(modelName: string): Promise<void>;
  searchAssets(pagination: SearchPaginationOptions, options: AssetSearchOptions): Paginated<AssetEntity>;
  searchCLIP(pagination: SearchPaginationOptions, options: SmartSearchOptions): Paginated<AssetEntity>;
  searchFaces(search: FaceEmbeddingSearch): Promise<FaceSearchResult[]>;
  upsert(smartInfo: Partial<SmartInfoEntity>, embedding?: Embedding): Promise<void>;
}
