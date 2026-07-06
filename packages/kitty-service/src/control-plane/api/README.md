# Control Plane API

The MVP control plane should expose read-first APIs for event inspection, conversation traces, active persona versions, active policy versions, outbound actions, and risk decisions.

Initial route groups:

- `GET /admin/events`
- `GET /admin/events/:id`
- `GET /admin/conversations/:id/messages`
- `GET /admin/personas`
- `PATCH /admin/personas/:id/activate`
- `GET /admin/policies`
- `PATCH /admin/policies/:id/activate`
- `GET /admin/actions`

Control-plane handlers must call service application ports instead of reading infrastructure storage directly.
