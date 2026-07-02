export interface ServiceModule {
  readonly name: string;
  readonly version: string;
  readonly dependsOn: readonly string[];
}

export function defineServiceModule(module: ServiceModule): ServiceModule {
  return module;
}
