# Contributing

Contributions are welcome, especially protocol captures from additional JMGO models that do not contain private identifiers.

## Development

Requires Node.js 20 or newer and pnpm 10.

```bash
pnpm install
pnpm check
pnpm test
pnpm pack
```

Add tests for protocol changes. Do not include captures containing serial numbers, Bluetooth addresses, account data, local network details, screenshots, or proprietary APKs.

Use Conventional Commits, for example:

```text
feat(remote): add mute key support
fix(play): reject mismatched split signers
```
