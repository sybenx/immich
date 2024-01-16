import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { writable, get, derived, readonly } from 'svelte/store';

export class SearchParams<T extends string> {
  private key: string;
  private store$ = writable<Array<T>>([]);

  constructor(key: string) {
    this.key = key;
    this.store$.subscribe(this.handleUpdate);
    this.store$.set((get(page).url.searchParams.get(this.key) || []) as Array<T>);
  }

  private handleUpdate = (values: Array<T>) => {
    if (values.length === 0) {
      get(page).url.searchParams.delete(this.key);
    } else {
      get(page).url.searchParams.set(this.key, values.join(','));
    }
    goto(`?${get(page).url.searchParams.toString()}`);
  };

  getValues() {
    return readonly(this.store$);
  }

  hasValue(value: T | Array<T>) {
    if (value instanceof Array) {
      return derived(this.getValues(), (values) => values.some((value) => value.includes(value)));
    }
    return derived(this.getValues(), (values) => values.includes(value));
  }

  addValue(value: T | Array<T>) {
    this.store$.update((values) => [...values, ...(value instanceof Array ? value : [value])]);
  }

  removeValue(value: T | Array<T>) {
    this.store$.update((values) =>
      values.filter((searchValue) => (value instanceof Array ? !value.includes(searchValue) : searchValue !== value)),
    );
  }
}
