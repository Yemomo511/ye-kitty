import type { PersonaId } from '@kitty/shared/types/ids';
import type { RepositoryPort } from '@kitty/shared/types/repository';
import type { Persona } from '../domain/persona';

export interface PersonaRepositoryPort extends RepositoryPort<Persona, PersonaId> {
  findActivePersona(): Promise<Persona>;
}
