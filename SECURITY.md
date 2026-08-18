# Security Policy

## Supported version

Security fixes are applied to the latest released version of `dsh-auth-gate`.
DeepSeek Harness is in developer preview, so compatibility may change between
Harness releases.

## Reporting a vulnerability

Please do not disclose an exploitable vulnerability in a public issue. Use
GitHub's **Security → Report a vulnerability** form for this repository. If
private vulnerability reporting is unavailable, contact the maintainer through
their GitHub profile and request a private channel.

Include the affected version, protection preset, Harness version, reproduction
steps, impact, and any proposed mitigation. Do not include real credentials,
session cookies, bearer tokens, or private workspace data.

## Scope and security boundary

This plugin adds authentication to Harness HTTP and WebSocket routes and rate
limits approval requests. It does not provide TLS, multi-user authorization,
per-user workspace isolation, or a substitute for host and network hardening.
See the README for deployment constraints and the current shared-identity model.
