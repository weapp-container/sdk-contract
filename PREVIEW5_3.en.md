<a id="preview53-源码要求"></a>
# preview.5.3 source requirements

[简体中文](PREVIEW5_3.md) · **English**


This source requires independently produced native runtime and SDK archives at
`0.1.0-preview.5.3`. C ABI remains 1. The prior preview.5.2 wrapper bundle and
its native preview.5.1 producer remain immutable historical artifacts. This
document grants no publication, simulator, hardware or parity acceptance.

An accepted Skia frame now retains Session-owned layout provenance: exact page,
input lifetime, logical host size, retained viewport and renderer revision. A
coordinate transition withdraws this provenance before guest jobs can run. A
new numeric revision, old GPU ACK, A-to-B-to-A resize, density repaint or surface
recreation cannot mint new layout authority from old pixels. A fresh accepted
layout still requires its own presentation acknowledgement.

Scrolling and pure density repaint may carry previously valid layout into a
new renderer revision; presenter retirement may carry the same coordinate
system into a new input lifetime. Neither operation acknowledges presentation.
A poisoned View remains ineligible and requires a new candidate Session.
Template consumed-input metadata stays independent: an explicit accepted frame
can own layout without falsely claiming to have executed a WXML template.

Native `SelectorQuery.in(pageOrComponent)` validates the actual registered
receiver and its incarnation, including retirement before page-mirror
publication. A delayed owned query cannot borrow a replacement instance or the
new top page. Unowned legacy native timer queries remain supported; callers
that need page ownership should use `.in(this)` with the real live instance.
The native facade's local checks do not assert full official selector parity
or replace the browser's independent presentation permits.

The original preview.5 JSON layout, navigation, health and attempt contracts in
`PREVIEW5.md` remain additive. No C function signature or guest messaging ABI
changes. Exact archive SHA-256 pins must be installed only after those bytes
are built and audited; an older lock must fail rather than fall back.
