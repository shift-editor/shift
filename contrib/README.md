# contrib

Optional extras that connect Shift to other tools. Nothing here is built, packaged, or shipped with Shift, and each entry is maintained on a best-effort basis: the tools they integrate with change on their own schedule.

Each entry builds only on Shift's documented interfaces, such as the [theme file format](../docs/themes.md). If one breaks, the interface it uses is the contract to check, and a fix belongs here rather than in the app.

| Entry                           | What it does                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [`omarchy/`](omarchy/README.md) | Keeps a Shift theme in step with the active [Omarchy](https://omarchy.org) theme |
