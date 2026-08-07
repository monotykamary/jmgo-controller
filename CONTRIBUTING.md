# Contributing

Contributions are welcome, especially protocol captures from additional JMGO models that do not contain private identifiers.

## Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
ruff check .
```

Add tests for protocol changes. Do not include captures containing serial numbers, Bluetooth addresses, account data, local network details, screenshots, or proprietary APKs.

Use Conventional Commits, for example:

```text
feat(remote): add mute key support
fix(play): reject mismatched split signers
```
