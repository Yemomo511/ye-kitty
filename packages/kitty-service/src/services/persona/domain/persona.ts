import type { PersonaId } from '@kitty/shared/types/ids';

export interface Persona {
  readonly id: PersonaId;
  readonly name: string;
  readonly version: string;
  readonly basePrompt: string;
  readonly stylePrompt: string;
  readonly boundaryPrompt: string;
  readonly isActive: boolean;
}
