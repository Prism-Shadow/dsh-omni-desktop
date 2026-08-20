# `@prismshadow/dsh-penguin-llm-router`

Desktop platform login for the DeepSeek Harness, as one dual-face plugin: the host half provides the `platformAuth` service — the B+verifier one-time-code flow (`code` in the browser URL, `device_secret` held by the process) against the Penguin API Hub platform, credential and settings provisioning for every LLM consumer, and the account-status authority — and the web half renders the login entry, signing-in overlay, and platform account settings section over the same namespace.

The browser-side flow is the platform's own: the desktop host pre-registers a login attempt (`POST /api/auth/desktop/start`), the GUI opens the returned `/api/auth/oauth/desktop?code=…` URL in the system browser, the user signs in at auth-center through the platform's OAuth page and approves on the platform confirmation page, and the service polls `POST /api/auth/desktop/poll` with the secret until the single delivery returns the relay key and provisioning URLs.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `platformBaseURL` | `https://token.penguin.ooo` | Platform origin; `/api/auth/desktop/*` and `/api/me/by-key` are appended |
| `apiKeyRef` | `PENGUIN_API_HUB_KEY` | Credential reference the relay key is stored under |
| `pollIntervalMs` | `2000` | Desktop code-flow poll cadence |
| `loginTimeoutMs` | `300000` | Hard cap on the signing-in phase |
| `verifyOnStart` | `true` | Revalidate a stored key through `/api/me/by-key` on boot |
| `clientName` | `dsh-desktop` | Client name recorded by the platform `start` endpoint |
| `clientVersion` | — | Optional client version recorded beside the name |

## Service API

- `status(): PlatformAuthStatus` — signed-out (with a readable reason), signing-in (with `authorizeUrl` and `expiresAt`), or signed-in (user, balance, verifiedAt).
- `login(): Promise<{ authorizeUrl }>` — mints code + secret, pre-registers at the platform, and starts the poll loop; rejects while a login is in flight and when the launching environment would shadow the credential write.
- `cancel(): void` — aborts the in-flight login.
- `logout(): Promise<void>` — drops the local credential and account snapshot and removes the consumer-section fields the login provisioned (the platform-side key stays revocable in the web console).
- `refresh(): Promise<void>` — revalidates the stored key through `/api/me/by-key`; a 401 clears the local login.

## Web UI

The browser half registers two slot entries sharing one auth controller: the sidebar footer login entry (`sidebar.footer.action`) and the platform account settings page (`settings.section`, tab 平台账号). Every surface renders the `platformAuth` service state and mutates it only through the auth RPC domain (`platformAuth.status` / `login` / `cancel` / `logout` / `refresh`). The controller owns the snapshot store and the signing-in poll timer; both entries share one controller, so surfaces in different corners of the shell converge on one state.

## Model Experience

### Platform provisioning after a claimed login

#### What the model sees

The login injects no prompt text. It commits the platform account snapshot (user, balance, and the three platform endpoint URLs) into the `penguin-api-hub` settings namespace, stores the relay key in the credentials seam, and rewrites the consumer sections — `llm-deepseek` (`baseURL`, `apiKeyEnv`), `llm-pi-ai` (`providers.google.apiKeyEnv` + `baseURL`), and `web-search-deepseek` (`baseURL`, `apiKeyEnv`) — so chat, search, and the vision subcall resolve their next request against the platform. `logout()` reverses those writes: it removes the relay key, clears the account snapshot, and path-unsets the same consumer fields, so every consumer falls back to its own configuration on the next request.

#### Token effect

Zero-direct: the package issues no model request and appends no session event. Every token effect is indirect, through the consumer sections each consumer resolves on its next request.

#### KV Cache effect

Independent requests with a new route: changing `baseURL` and `apiKeyEnv` invalidates any reuse prefix built against the previous endpoint, and each consumer starts a fresh prefix against the platform route. A logout, a by-key 401 clearing the credential, or the next login changes the same fields again.

## Data Storage and Uninstall

The login provisions persistent user data in the harness home (`~/.dsh`), across two stores:

- `~/.dsh/.credentials.yaml` — the relay key, under the credential reference from `apiKeyRef` (default `PENGUIN_API_HUB_KEY`).
- `~/.dsh/settings.yaml` — the `penguin-api-hub` account snapshot, plus the consumer sections the login rewrote (`llm-deepseek`, `llm-pi-ai`, `web-search-deepseek`).

`logout()` removes all of it: the relay key, the account snapshot, and exactly the consumer-section fields this plugin wrote (path-level, so any consumer settings you had before the login survive). Uninstalling the plugin (`dsh plugin remove …`) is different: it withdraws only the runtime registrations (the `platformAuth` service, its Typert routes, the settings section, and the poll timer) and leaves the data above in place, per the DSH convention that an uninstall never touches user data. To remove the plugin's footprint completely after an uninstall, log out from the account settings page first, then delete the `penguin-api-hub` section and the `PENGUIN_API_HUB_KEY` credential from the two files under `~/.dsh/`.

## Known Limitations and Deferred Work

- The status is read by polling `status()`; there is no push channel yet. The web GUI's auth panel owns that cadence, and a future global event seam can replace it without changing the service API.
- The provisioning writes require the consumer plugins to be mounted (`llm-deepseek`, `llm-pi-ai`, `web-search-deepseek` all register their settings namespaces); in a profile without one of them, that write fails loudly and the login lands signed-out with `write-failed` rather than half-provisioning.
- The platform protocol is the B+verifier design (start / claim / poll / by-key) documented in the product plan; the client treats any unclaimed status vocabulary as a failure rather than guessing.
- `logout` is local-only: revoking the platform key needs the platform web console (or a future by-key revoke endpoint).
- Web UI copy is hardcoded Chinese product text; a locale seat can replace it when this feature graduates to the standard dictionary treatment.
- The settings page shows user, balance, and the login verbs only; the platform endpoints and key alias are not displayed (the host stores them, and the Models page owns the connection facts).
