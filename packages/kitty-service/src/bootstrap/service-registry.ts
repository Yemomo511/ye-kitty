import { defineServiceModule } from '@kitty/shared/application/service-module';

export const serviceRegistry = [
  defineServiceModule({
    name: 'event-gateway',
    version: '0.0.1',
    dependsOn: ['contracts', 'shared'],
  }),
  defineServiceModule({
    name: 'conversation',
    version: '0.0.1',
    dependsOn: ['contracts', 'shared'],
  }),
  defineServiceModule({
    name: 'persona',
    version: '0.0.1',
    dependsOn: ['shared'],
  }),
  defineServiceModule({
    name: 'policy',
    version: '0.0.1',
    dependsOn: ['contracts', 'shared'],
  }),
  defineServiceModule({
    name: 'llm',
    version: '0.0.1',
    dependsOn: ['contracts', 'conversation', 'persona', 'policy', 'shared'],
  }),
  defineServiceModule({
    name: 'risk',
    version: '0.0.1',
    dependsOn: ['llm', 'shared'],
  }),
  defineServiceModule({
    name: 'actions',
    version: '0.0.1',
    dependsOn: ['contracts', 'shared'],
  }),
] as const;
