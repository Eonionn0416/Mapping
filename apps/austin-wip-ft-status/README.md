# Austin WIP and FT status

QA Page 04. Open index.html through the existing QA host, or a local HTTP server. No build or CDN dependency is required. The bundled SheetJS reader is reused.

## Storage and updates

The eight supplied workbooks are included as initial data, loaded only when this app's IndexedDB store is empty. Daily XLSX uploads are validated and previewed before saving. Full snapshots are required for Bank/WIP: a valid header-only sheet means no inventory, while a missing sheet is not interpreted as an empty snapshot. A parse error rejects the complete selected upload. File names must include _YYYYMMDD or _YYYYMMDDHH. Same type/report timestamp replaces that snapshot; other timestamps are retained. Backdated uploads rebuild history chronologically. JSON backup/restore transfers history; restore retains existing snapshots on timestamp conflicts. No automatic history deletion. The default display window is one year; older data remains available for opening balances and process history.

This app stores data on this browser/origin, without Firebase synchronization. The former Austin FT MERGE report implementation, Firebase config alias and local rules block were removed. Existing remote database records are not deleted, and Firebase rules are not remotely deployed by this change. Unrelated QA tools are preserved.

## Definitions

- Bank and Bump Bank: Device + Customer Lot. First snapshot is opening inventory, not a fabricated receipt. Subsequent positive/negative wafer and die differences are independently retained; missing lots are issued on the next report date. Lead time uses DATE RECEIVED.
- Test WIP: Device + Wafer Lot + full SCK Marking Batch. Assy: Device + Wafer Lot + MARKING (RUN NO). Bump WIP: Device + Wafer Lot. Process names are read separately from each report, after REJECT QTY (Test) or OUTPUT DATE (Assy/Bump).
- Current process shows every nonzero process, including holding positions. QTY is authoritative current total; process columns are not summed because STORE_BANK can overlap FGS. Process history preserves maximum observed quantity and sum of positive observed changes. This is observed flow, not guaranteed throughput: between-snapshot movement and rework are not identifiable.
- Assy input uses INPUT QTY. Test/Bump input is maximum observed QTY and explicitly marked estimated. WIP decrease excludes known increases in Test REJECT QTY; Assy/Bump lack Reject and their decrease may include rejects. A missing lot is WIP exit on the next snapshot, not confirmed customer shipment. OUTPUT DATE is retained as source metadata and never closes a lot that remains present.
- Test Lead Time over 3month uses calendar-month anniversary compared with today's Asia/Seoul date, not 90 days. This is also shown for other active WIP lots.
- Chip Bank is the latest snapshot, grouped by Device/Bin. Bin900 is excluded from the standard Pareto and shown separately. Do not sum daily stock snapshots.
- Assy yield: total ASSY_OUT_QTY / total ASSY_IN_QTY; DPPM = ASSY_DEFECT_QTY / ASSY_IN_QTY × 1,000,000. Defects start after ASSY_DPPM.
- Bump yield: GROSS DIE-weighted BUMP YIELD. DPPM = BUMP_DEFECTS / GROSS DIE × 1,000,000. Good die count is GROSS DIE minus BUMP_DEFECTS. Source yield is rounded, so its weighted yield can differ slightly from reconstructed good-die yield. Wafer ID and SUBLOT_ID participate in deduplication. Defects start after DEFECT_PPM.
- Assy/Bump weekly close-date interval: Thursday through Wednesday. WW is the ISO week containing the Wednesday; presentation date is the following Tuesday. Weekly graphs show twelve consecutive weeks and top five defects by total in the displayed period. Daily supports Top5/Top10/All. Missing weeks are blank Yield/DPPM, never 0% yield.
- FT yield uses Test in date ISO week, preserving Test out Qty in that same input cohort. Yield is total Out / total In. Key includes Device, Lot ID, Factory Lot Number, Test in date, Test Program and Work Order; repeated cumulative reports update existing records.

## Validation

All eight supplied workbooks parsed (10 snapshots; Assy WIP 2, Bank 2, Test WIP 267, Chip Bank 246, empty Bump Bank/WIP, Assy yield 14, empty Oct 14 Bump yield, Sep 30 Bump yield 50, FT yield 26). Synthetic tests cover duplicate import, corrected/backdated imports, partial receipts/issues, missing lots, process retention, rejection-adjusted WIP decrease, calendar lead time and ISO/year/week boundaries. Bump sample total: 194,375 gross die and 51 defects; DPPM 262.3794.

Update 2026-10-22: Assy, Bump and FT weekly charts all use twelve consecutive weeks. Responsive SVG charts use the panel width without horizontal chart scrolling. Daily views and underlying one-year/history retention remain available.
