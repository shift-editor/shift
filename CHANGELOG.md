# Changelog

## [0.1.1](https://github.com/shift-editor/shift/compare/v0.1.0...v0.1.1) (2026-08-22)


### Features

* add desktop application updates ([92d54f1](https://github.com/shift-editor/shift/commit/92d54f17d0e41ad3080dbfd560a2151f4faec3c6))
* add macOS DMG packages ([4bc9845](https://github.com/shift-editor/shift/commit/4bc98457a8fb2c2fe1da9e4215e8fc6d68264927))
* **desktop:** add distinct nightly app icon ([ff246f0](https://github.com/shift-editor/shift/commit/ff246f02dc130db0f6e5280c58feaa0ed04e0503))
* **desktop:** add macOS 26 app icons ([a8074e9](https://github.com/shift-editor/shift/commit/a8074e9ecf886bd048e2551b4124f3b408fe6805))
* **desktop:** add macOS 26 app icons ([de09d2d](https://github.com/shift-editor/shift/commit/de09d2d4d2f95efc2261c629f783a7b6aa7e2b1a))
* **desktop:** add signed application updates ([6cec9d3](https://github.com/shift-editor/shift/commit/6cec9d399a729fa55a91a6985e473fd78600864b))
* **desktop:** save previews as Shift documents ([#250](https://github.com/shift-editor/shift/issues/250)) ([71ff489](https://github.com/shift-editor/shift/commit/71ff489924b8b9f24e780de6b50de935f3762576))
* **desktop:** update Nightly app icon ([409daff](https://github.com/shift-editor/shift/commit/409daff38a359182de98bba18b6e8765c1179683))
* distribute installable Developer Preview builds ([fbbc3bf](https://github.com/shift-editor/shift/commit/fbbc3bfd9908941da0729e7916845fa2d309a35c))
* distribute installable Developer Preview builds ([45b3c28](https://github.com/shift-editor/shift/commit/45b3c289f478d6b5006ab7a64048c0e108b45d86))
* **document:** add atomic preview conversion core ([#249](https://github.com/shift-editor/shift/issues/249)) ([3818bae](https://github.com/shift-editor/shift/commit/3818bae7f576bf179d1f2c7d3fd45382496bc099))
* **document:** make SQLite the only .shift format ([#244](https://github.com/shift-editor/shift/issues/244)) ([8e08686](https://github.com/shift-editor/shift/commit/8e086863d8bd26ffb72497c6ce7375ad3ee3af2d))
* **release:** add macOS DMG packages ([7c40280](https://github.com/shift-editor/shift/commit/7c40280306e3f39c4f80992cda11cb6a53261473))
* support replaceable tool contributions ([54e4994](https://github.com/shift-editor/shift/commit/54e4994921ea3f624c00c0bc158a4574c892bde3))


### Bug Fixes

* bundle Inter with packaged renderer ([fb7b37d](https://github.com/shift-editor/shift/commit/fb7b37d5f7156ed52cb7ff8ee81905a3fb78dd90))
* **ci:** bootstrap empty update-feed branch ([#256](https://github.com/shift-editor/shift/issues/256)) ([8539445](https://github.com/shift-editor/shift/commit/853944509d606b90c32fef9da44c06d236392bc6))
* **ci:** restore update-feed publication ([#265](https://github.com/shift-editor/shift/issues/265)) ([dccd497](https://github.com/shift-editor/shift/commit/dccd497f4cdca2eda5ed94cbfdfd4233e562ab4a))
* **ci:** tolerate packaged smoke cleanup locks ([c8a85b4](https://github.com/shift-editor/shift/commit/c8a85b4998e5f8ab11785f7a2107aa64bd23c05f))
* clear dirty at the saved undo position ([5a14a68](https://github.com/shift-editor/shift/commit/5a14a681686c3891c66304de27c93923d8a418b6))
* clear idle pointer after leaving canvas ([b5d5f12](https://github.com/shift-editor/shift/commit/b5d5f12ef76107910b18ae17aecc1236f3a379b3))
* clear stale vector pointer state ([ce45945](https://github.com/shift-editor/shift/commit/ce4594516b05f3cf3bd17b9104760670fb19ae7d))
* correct packaged application assets ([1615a91](https://github.com/shift-editor/shift/commit/1615a91bbea10dc3188b4999a889ad28ec5c0772))
* correct packaged asset startup ([7701216](https://github.com/shift-editor/shift/commit/7701216d1316bf0b0311aa00bcd770fa91b337c8))
* **desktop:** keep app icons consistent across builds ([c1de914](https://github.com/shift-editor/shift/commit/c1de9148ce760f556463eba475c483202ce7a3e1))
* **desktop:** keep app icons consistent across builds ([94428e4](https://github.com/shift-editor/shift/commit/94428e4e6b37f825650c00f2df34208df2b3c009))
* **desktop:** preserve macOS product names ([37b3be1](https://github.com/shift-editor/shift/commit/37b3be149df9c70f6163ece709f279f03ebef6e8))
* **desktop:** refine macOS app icons ([4e84d7f](https://github.com/shift-editor/shift/commit/4e84d7fa6d517e9b76ce9b75c6db66ca47585609))
* **desktop:** route native menus to the active document ([#252](https://github.com/shift-editor/shift/issues/252)) ([0f0ef19](https://github.com/shift-editor/shift/commit/0f0ef196f2a34a5fe1ad36a3534efb3612482de3))
* **desktop:** update nightly app icon ([79ef221](https://github.com/shift-editor/shift/commit/79ef221593e425106946ade81c0b1e33f8a34055))
* **desktop:** update nightly app icon ([03c50dd](https://github.com/shift-editor/shift/commit/03c50dd8e2b94a5fd892cd5ec8e3147f5c3da1e9))
* **editor:** roll back canceled drag edits ([32ec62c](https://github.com/shift-editor/shift/commit/32ec62cac2a738e175aa37c075af084c4a194e2a))
* keep sparse source editability reactive ([f806e06](https://github.com/shift-editor/shift/commit/f806e0671da9f6b244383eff797a8dda8bb67f07))
* label variable and advance inputs ([c0d9a1a](https://github.com/shift-editor/shift/commit/c0d9a1a6aac8e6001762b393503a44006ca77fad))
* load custom cursors in packaged app ([545c871](https://github.com/shift-editor/shift/commit/545c871726cf172e7f4d41db849bff43ecb66ee3))
* make Pen curve gestures persistent and selection bounds exact ([96a3dee](https://github.com/shift-editor/shift/commit/96a3deeebac38a12a21e0cbaffa213848373e73e))
* preserve angle snap hysteresis across boundaries ([fd721b5](https://github.com/shift-editor/shift/commit/fd721b5450f42a5bfc3bf622c5623462e0b9f8d0))
* prune contours emptied by point removal ([de9c9ad](https://github.com/shift-editor/shift/commit/de9c9ad89600a41df8fc03c011f7db9d426356e1))
* prune empty contours during clipboard edits ([87286cf](https://github.com/shift-editor/shift/commit/87286cf2c9597a4714526962338880934fc479f1))
* publish tool lifecycle state ([e93c8a5](https://github.com/shift-editor/shift/commit/e93c8a5f641073ed18c7a72406de65b70e014a75))
* **release:** harden updater publication and smoke teardown ([1a10718](https://github.com/shift-editor/shift/commit/1a10718f320b3d52a7cb54ef69fe1057b5611292))
* **scripts:** exclude docs dir from source freshness comparison ([0d8884e](https://github.com/shift-editor/shift/commit/0d8884ec6bb5a9519eb3ac589bdecb24ba0db737))
* tolerate Windows packaged-smoke cleanup locks ([0bd4915](https://github.com/shift-editor/shift/commit/0bd491512b2ad27f67d30faff226289cb1aadee5))

## Changelog

All notable changes to Shift will be documented in this file.

This changelog is maintained by [Release Please](https://github.com/googleapis/release-please).
