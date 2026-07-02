# Kitty Service MVP Architecture

This package owns the Ye-Kitty service layer. The MVP is a modular monolith with microservice-shaped boundaries so each module can later move behind HTTP, RPC, queue, or worker processes without changing the domain contracts.

## Dependency Direction

```text
bootstrap
  -> control-plane
  -> platforms
  -> services
  -> contracts
  -> shared
```

Rules:

- `shared` has no dependency on service or platform modules.
- `contracts` contains cross-service event and action DTOs only.
- `services/*/domain` contains business objects and local value types.
- `services/*/application` orchestrates use cases inside one service boundary.
- `services/*/ports` defines inbound and outbound interfaces.
- `services/*/infrastructure` adapts databases, queues, SDKs, and model providers.
- `platforms/*` converts platform-specific payloads into contracts and executes platform actions.
- `control-plane` reads service state and changes configuration; it does not bypass service ports.
- `bootstrap` is the only place that wires concrete implementations together.

## MVP Message Flow

```text
QQ raw payload
  -> platforms/qq
  -> services/event-gateway
  -> contracts/events
  -> services/conversation
  -> services/persona
  -> services/policy
  -> services/llm
  -> services/risk
  -> services/actions
  -> platforms/qq
```

## Service Boundaries

- `event-gateway`: receives raw ingress, normalizes events, deduplicates, and publishes chat events.
- `conversation`: owns conversations, participants, and recent message context.
- `persona`: owns Ye-Kitty persona versions and activation rules.
- `policy`: decides whether an event should become a reply, refusal, human review, or silence.
- `llm`: builds model requests and returns structured generation results.
- `risk`: checks generated content before external delivery.
- `actions`: persists and executes outbound social actions.

Each boundary exposes ports first. Infrastructure implementations can be added later without changing callers.
