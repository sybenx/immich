import { authenticate } from '$lib/utils/auth';
import { AssetResponseDto, SearchResponseDto, api } from '@api';
import type { PageLoad } from './$types';

export const load = (async (data) => {
  await authenticate();
  const term = data.url.searchParams.get('q') || data.url.searchParams.get('query') || undefined;
  let results: SearchResponseDto | null = null;
  if (term) {
    const res = await api.searchApi.search({}, { params: data.url.searchParams });
    const assetItems: Array<AssetResponseDto> = (data as any).results?.assets.items;
    console.log('assetItems', assetItems);
    const assets = {
      ...res.data.assets,
      items: assetItems ? assetItems.concat(res.data.assets.items) : res.data.assets.items
    };
    results = {
      assets,
      albums: res.data.albums
    }
  }

  return {
    term,
    results,
    meta: {
      title: 'Search',
    },
  };
}) satisfies PageLoad;
