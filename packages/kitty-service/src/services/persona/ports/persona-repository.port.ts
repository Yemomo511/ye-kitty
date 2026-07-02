import type { PersonaId } from '@kitty/shared/domain/ids';
import type { RepositoryPort } from '@kitty/shared/ports/repository.port';
import type { Persona } from '../domain/persona';

export interface PersonaRepositoryPort extends RepositoryPort<Persona, PersonaId> {
  findActivePersona(): Promise<Persona>;
}
