export interface RepositoryPort<TEntity, TId extends string> {
  findById(id: TId): Promise<TEntity | null>;
  save(entity: TEntity): Promise<TEntity>;
}
