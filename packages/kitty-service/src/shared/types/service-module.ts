export interface ServiceModule {
  readonly name: string;
  readonly version: string;
  readonly dependsOn: readonly string[];
}
