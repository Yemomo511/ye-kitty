export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ChatEventId = Brand<string, 'ChatEventId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ParticipantId = Brand<string, 'ParticipantId'>;
export type PersonaId = Brand<string, 'PersonaId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type ActionId = Brand<string, 'ActionId'>;

export type Platform = 'qq';

export interface Timestamped {
  readonly createdAt: Date;
  readonly updatedAt?: Date;
}
