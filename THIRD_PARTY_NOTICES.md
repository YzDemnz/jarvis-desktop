# JARVIS Integration Lab - third-party notices

Phase A only, 2026-09-27. Production baseline 3395ec6 is preserved. These are
development-only packages. No external engine, model, credential, or repository
is included in the JARVIS packaged application's approved file list. No installer
is produced by this phase. This file is not a legal clearance for distribution.

| Component | Pinned version | License | Use |
|---|---|---|---|
| @agentclientprotocol/sdk | 1.5.0 | Apache-2.0 | stdio ACP v1 transport and fake agent |
| @agentclientprotocol/codex-acp | 1.13.1 | Apache-2.0 | external lab process; not first-party OpenAI adapter |
| @openai/codex | 0.156.1 | Apache-2.0; bundled notices also apply | official external backend / managed auth |
| @agentclientprotocol/claude-agent-acp | 0.81.2 | Apache-2.0 | external lab process |
| @anthropic-ai/claude-agent-sdk | 0.3.280 | proprietary, SEE LICENSE IN README.md | external backend; distribution NOT approved |
| @opencode-ai/sdk | 1.18.32 | MIT | official OpenCode HTTP SDK |
| opencode-ai | 1.18.32 | MIT, binary/transitive obligations not fully cleared | external Windows server |

Exact package paths, versions, resolved tarball URLs and integrity hashes,
including relevant transitive and optional-platform packages, are recorded in
[provenance-lock.json](third_party/provenance-lock.json). Root license/notice texts
actually present in installed packages are retained in [licenses](third_party/licenses/).
Packages absent on this OS are inventoried, not claimed to have been inspected.

The Claude SDK and Windows backend license notices explicitly refer to Anthropic
legal agreements. Apache licensing of the adapter does NOT relicense that SDK.
Its exact shipped LICENSE.md is retained. Redistribution requires separate review.

OpenCode SDK and some platform packages omit root license texts; the upstream
OpenCode MIT license is retained separately. Codex native resources include other
licenses (including LGPL notices). A future redistribution must inventory bundled
native dependencies/resources, source-offer obligations where applicable, and all
NOTICE files. Phase A does not approve such distribution.

goose source at 04ed836c8cde23e540cc77d256992e00be99298b was a design reference only.
No goose package, binary, or source was copied. Lease/pruning code is independently
implemented; OpenCode algorithms were not vendored. Retained dependency license
files are verbatim, apart from newline normalization.

Missing package license files and incomplete binary SBOM mean distribution gate:
BLOCKED. The laboratory may be tested locally; do not ship node_modules wholesale.
