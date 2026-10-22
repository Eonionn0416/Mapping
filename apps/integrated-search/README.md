# Integrated QA Search

QA menu 01. Query Customer, Device, complete Lot No, or AI/BI No. Multiple supplied fields narrow the search. Lot identity preserves suffixes; partial matching must be explicitly selected. Confirmed lot links add records from sources whose Customer/Device metadata is absent, but exclude conflicting known Customer/Device values. Missing source metadata is displayed rather than invented.

Sources: 2DID Mapping Firestore history row chunks, MTK Assy/OS/Bin Firestore, Austin IndexedDB snapshots, REL Firestore plus local history, MNT Hold Firestore plus local history, NPI local history, AI/BI Revision DB, and Issue Summary. Each source reports success/failure independently. Data stored only in the browser is available on the same browser and QA origin. The first query reads source history; subsequent queries reuse it until Refresh.

Source links include the record/lot context. 2DID links restore that exact saved history. Other tool links show the original record and fill supported lot searches. AI/BI links open parameters and the preceding Revision comparison when present. No ambiguous cross-document identity is invented.

Issue Summary accepts the supplied Lot/Comment template and aliases Issue Description / Issue Discription. Customer, Device and AI/BI are optional columns for more specific binding. The preview must be saved; identical rows are idempotent, multiple distinct comments are preserved. Issues are shown in the far-right result column and can also appear as standalone lot records. Direct entry uses the complete Lot No. Issues save to browser first and Firestore next; failures remain visible and can be retried.

V35 adds Issue Summary XLSX download (Lot/Comment first, optional identifying metadata retained), independent PCN records, and Daily Tracker title/Revision links. Download refreshes remote issues first and visibly falls back to browser history when offline. Tracker narrative search uses complete identifier boundaries by default.
