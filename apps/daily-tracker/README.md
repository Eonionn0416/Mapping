# Daily Tracker

QA menu 10. The supplied workbook is an initial browser snapshot. Reference sheets without a tracker/to-do schema (Device List, address) are excluded from issue lists.

Supported schemas: Title / Criteria / Device (including source typo Deivce) / No / Start date / Current status / Owner / Due date / Progress, and Customer / Date / Item / Status. Merged cells supply shared Title, Criteria, Device and Progress. Explicit Done and any hidden/very-hidden source sheet are Done. Explicit On going is shown by default; Done history and other/missing statuses are collapsed separately. Original source Progress is retained even when sheet visibility overrides the display state.

Excel updates are stored as complete immutable Revision snapshots. The same series and content digest are idempotent. Earlier snapshots remain selectable; comparison shows added, changed and omitted items without treating omission as completion. Source row shifts alone are ignored. A Report series groups successive uploads independently of the filename. Browser storage is IndexedDB QADailyTracker/versions; Firestore metadata and chunks use dailyTrackerVersions. Chunks are saved before the manifest, and SHA-256 is checked on load. The sync button retries pending local versions and loads remote metadata.

Integrated QA Search indexes title, progress content, known Device/Lot/AI references and the Revision link. A complete Lot identifier can also match narrative text. Removed records retain their last locally available Revision as historical records; full Revision history is opened in Daily Tracker.
