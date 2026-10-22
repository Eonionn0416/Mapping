# AI/BI Comparison and Revision DB

QA menu 07. Select either comparison side, or both. A completed attachment triggers automatic storage; Compare repeats the same idempotent storage procedure. Save errors are displayed, and the retry button repeats storage.

Document identity comes only from the workbook's AI NO / BI NO label and adjacent value, supporting header/value rows and label/value columns. The parenthesized English letters are Revision. Customer is the prefix before the first hyphen, or the first three characters when no hyphen exists. Devices come from the internal Device field, separated by commas. Filename is retained only as provenance and never substitutes for identity. Ambiguous/missing identity or missing Device rejects storage with an explanation.

Every source sheet cell value/formula and merge layout is retained. Firestore aibiDocuments manifests reference SHA-256-verified chunks. Same kind/number/Revision/content is idempotent; changed content under the same Revision remains another variant. DB dropdowns allow any two stored documents, including different numbers, to be compared. REL PCN links open the specified Revision and compare it with the previous stored Revision when one exists.
