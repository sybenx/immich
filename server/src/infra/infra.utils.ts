import { AssetSearchBuilderOptions, Paginated, PaginationOptions } from '@app/domain';
import _ from 'lodash';
import {
  Between,
  FindManyOptions,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { PaginatedBuilderOptions, PaginationMode, PaginationResult, chunks, setUnion } from '../domain/domain.util';
import { DATABASE_PARAMETER_CHUNK_SIZE } from './infra.util';
import { AssetEntity } from './entities';

/**
 * Allows optional values unlike the regular Between and uses MoreThanOrEqual
 * or LessThanOrEqual when only one parameter is specified.
 */
export function OptionalBetween<T>(from?: T, to?: T) {
  if (from && to) {
    return Between(from, to);
  } else if (from) {
    return MoreThanOrEqual(from);
  } else if (to) {
    return LessThanOrEqual(to);
  }
}

export const isValidInteger = (value: number, options: { min?: number; max?: number }): value is number => {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  return Number.isInteger(value) && value >= min && value <= max;
};

function paginationHelper<Entity extends ObjectLiteral>(items: Entity[], take: number): PaginationResult<Entity> {
  const hasNextPage = items.length > take;
  items.splice(take);

  return { items, hasNextPage };
}

export async function paginate<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
  { take, skip }: PaginationOptions,
  searchOptions?: FindManyOptions<Entity>,
): Paginated<Entity> {
  const items = await repository.find(
    _.omitBy(
      {
        ...searchOptions,
        // Take one more item to check if there's a next page
        take: take + 1,
        skip,
      },
      _.isUndefined,
    ),
  );

  return paginationHelper(items, take);
}

export async function paginatedBuilder<Entity extends ObjectLiteral>(
  qb: SelectQueryBuilder<Entity>,
  { take, skip, mode }: PaginatedBuilderOptions,
): Paginated<Entity> {
  if (mode === PaginationMode.LIMIT_OFFSET) {
    qb.limit(take + 1).offset(skip);
  } else {
    qb.skip(take + 1).take(skip);
  }

  const items = await qb.getMany();
  return paginationHelper(items, take);
}

export const asVector = (embedding: number[], quote = false) =>
  quote ? `'[${embedding.join(',')}]'` : `[${embedding.join(',')}]`;

/**
 * Wraps a method that takes a collection of parameters and sequentially calls it with chunks of the collection,
 * to overcome the maximum number of parameters allowed by the database driver.
 *
 * @param options.paramIndex The index of the function parameter to chunk. Defaults to 0.
 * @param options.flatten Whether to flatten the results. Defaults to false.
 */
export function Chunked(options: { paramIndex?: number; mergeFn?: (results: any) => any } = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const paramIndex = options.paramIndex ?? 0;
    descriptor.value = async function (...args: any[]) {
      const arg = args[paramIndex];

      // Early return if argument length is less than or equal to the chunk size.
      if (
        (arg instanceof Array && arg.length <= DATABASE_PARAMETER_CHUNK_SIZE) ||
        (arg instanceof Set && arg.size <= DATABASE_PARAMETER_CHUNK_SIZE)
      ) {
        return await originalMethod.apply(this, args);
      }

      return Promise.all(
        chunks(arg, DATABASE_PARAMETER_CHUNK_SIZE).map(async (chunk) => {
          await originalMethod.apply(this, [...args.slice(0, paramIndex), chunk, ...args.slice(paramIndex + 1)]);
        }),
      ).then((results) => (options.mergeFn ? options.mergeFn(results) : results));
    };
  };
}

export function ChunkedArray(options?: { paramIndex?: number }): MethodDecorator {
  return Chunked({ ...options, mergeFn: _.flatten });
}

export function ChunkedSet(options?: { paramIndex?: number }): MethodDecorator {
  return Chunked({ ...options, mergeFn: setUnion });
}

export function searchAssetBuilder(
  builder: SelectQueryBuilder<AssetEntity>,
  options: AssetSearchBuilderOptions,
): SelectQueryBuilder<AssetEntity> {
  const { date, id, exif, path, relation, status } = options;

  if (date) {
    builder.andWhere(
      _.omitBy(
        {
          createdAt: OptionalBetween(date.createdAfter, date.createdBefore),
          updatedAt: OptionalBetween(date.updatedAfter, date.updatedBefore),
          deletedAt: OptionalBetween(date.trashedAfter, date.trashedBefore),
          fileCreatedAt: OptionalBetween(date.takenAfter, date.takenBefore),
        },
        _.isUndefined,
      ),
    );
  }

  if (exif) {
    const exifWhere = _.omitBy(exif, _.isUndefined);
    builder.andWhere(exifWhere);
    if (Object.keys(exifWhere).length > 0) {
      builder.leftJoin(`${builder.alias}.exifInfo`, 'exifInfo');
    }
  }

  if (id) {
    builder.andWhere(_.omitBy(id, _.isUndefined));
  }

  if (path) {
    builder.andWhere(_.omitBy(path, _.isUndefined));
  }

  if (status) {
    const { isEncoded, isMotion, ...otherStatuses } = status;
    builder.andWhere(_.omitBy(otherStatuses, _.isUndefined));

    if (isEncoded && !path?.encodedVideoPath) {
      builder.andWhere({ encodedVideoPath: Not(IsNull()) });
    }

    if (isMotion) {
      builder.andWhere({ livePhotoVideoId: Not(IsNull()) });
    }
  }

  if (relation) {
    const { withExif, withFaces, withPeople, withSmartInfo, withStacked } = relation;

    if (withExif) {
      builder.leftJoinAndSelect(`${builder.alias}.exifInfo`, 'exifInfo');
    }

    if (withFaces || withPeople) {
      builder.leftJoinAndSelect(`${builder.alias}.faces`, 'faces');
    }

    if (withPeople) {
      builder.leftJoinAndSelect(`${builder.alias}.person`, 'person');
    }

    if (withSmartInfo) {
      builder.leftJoinAndSelect(`${builder.alias}.smartInfo`, 'smartInfo');
    }

    if (withStacked) {
      builder.leftJoinAndSelect(`${builder.alias}.stack`, 'stack');
    }
  }

  const withDeleted = status?.withDeleted ?? (date?.trashedAfter !== undefined || date?.trashedBefore !== undefined);
  if (withDeleted) {
    builder.withDeleted();
  }

  return builder;
}
