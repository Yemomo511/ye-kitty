import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const requiredPaths = [
  'src/ARCHITECTURE.md',
  'src/index.ts',
  'src/bootstrap/service-registry.ts',
  'src/shared/abstracts/capability-base.ts',
  'src/shared/abstracts/template-use-case.ts',
  'src/shared/application/service-module.ts',
  'src/shared/strategies/strategy-registry.ts',
  'src/shared/types/capability.ts',
  'src/shared/types/event-bus.ts',
  'src/shared/types/ids.ts',
  'src/shared/types/logger.ts',
  'src/shared/types/repository.ts',
  'src/shared/types/service-module.ts',
  'src/shared/types/strategy.ts',
  'src/shared/types/template-method.ts',
  'src/shared/types/use-case.ts',
  'src/contracts/events/chat-event.contract.ts',
  'src/contracts/actions/outgoing-action.contract.ts',
  'src/platforms/qq/ports/qq-bot-client.port.ts',
  'src/services/event-gateway/ports/event-ingress.port.ts',
  'src/services/conversation/ports/conversation-repository.port.ts',
  'src/services/persona/ports/persona-repository.port.ts',
  'src/services/policy/ports/policy-evaluator.port.ts',
  'src/services/llm/ports/llm-provider.port.ts',
  'src/services/risk/ports/risk-guard.port.ts',
  'src/services/actions/ports/action-dispatcher.port.ts'
];

const missing = requiredPaths.filter((path) => !existsSync(join(root, path)));
if (missing.length > 0) {
  console.error('Missing architecture files:');
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

const servicesRoot = join(root, 'src/services');
const serviceNames = readdirSync(servicesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const requiredServiceFolders = ['application', 'domain', 'ports', 'infrastructure'];
const invalidServices = [];

for (const serviceName of serviceNames) {
  for (const folder of requiredServiceFolders) {
    const path = join(servicesRoot, serviceName, folder);
    if (!existsSync(path)) invalidServices.push(`${serviceName}/${folder}`);
  }
}

if (invalidServices.length > 0) {
  console.error('Services without standard folders:');
  for (const path of invalidServices) console.error(`- ${path}`);
  process.exit(1);
}

console.log(`Architecture skeleton validated for ${serviceNames.length} service modules.`);
