import type { ServiceModule } from '@kitty/shared/types/service-module';

export type { ServiceModule } from '@kitty/shared/types/service-module';

export function defineServiceModule(module: ServiceModule): ServiceModule {
  return module;
}
