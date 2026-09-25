export type PersistedMutationResult<T> =
  | { ok: true; latest: boolean; value: T }
  | { ok: false; latest: boolean; rollback: T; error: unknown }

export class PersistedMutationCoordinator {
  private readonly generations = new Map<string, number>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly confirmed = new Map<string, unknown>()

  run<T>(key: string, initialConfirmed: T, persist: () => Promise<T>, queueKey = key): Promise<PersistedMutationResult<T>> {
    if (!this.confirmed.has(key)) this.confirmed.set(key, initialConfirmed)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)

    const previous = this.queues.get(queueKey) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(persist)
    const result: Promise<PersistedMutationResult<T>> = operation
      .then(value => {
        this.confirmed.set(key, value)
        return { ok: true as const, latest: this.generations.get(key) === generation, value }
      })
      .catch(error => ({
        ok: false,
        latest: this.generations.get(key) === generation,
        rollback: this.confirmed.get(key) as T,
        error,
      } as const))
    const tail = result.then(() => undefined)
    this.queues.set(queueKey, tail)
    void tail.finally(() => {
      if (this.queues.get(queueKey) === tail) this.queues.delete(queueKey)
    })
    return result
  }
}
