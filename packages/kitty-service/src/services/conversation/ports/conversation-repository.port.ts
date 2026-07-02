import type { ConversationId } from '@kitty/shared/domain/ids';
import type { RepositoryPort } from '@kitty/shared/ports/repository.port';
import type { Conversation } from '../domain/conversation';
import type { ConversationMessage } from '../domain/message';

export interface ConversationRepositoryPort
  extends RepositoryPort<Conversation, ConversationId> {
  findRecentMessages(
    conversationId: ConversationId,
    limit: number,
  ): Promise<readonly ConversationMessage[]>;
}
