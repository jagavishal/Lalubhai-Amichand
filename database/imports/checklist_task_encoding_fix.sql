-- Repairs checklist task text that reads as "ma?am" / "ma<?>am" in the UI.
--
-- The apostrophe in these rows is not a code bug: the pool sets the connection
-- to utf8mb4 on every connect (see server.js, "SET NAMES 'utf8mb4'"), so rows
-- written by the app are clean. The broken rows predate that, or arrived through
-- an import that spoke latin1 — the byte for a curly apostrophe was stored raw,
-- and utf8mb4 has no way to read it back, so the browser paints U+FFFD instead.
--
-- Three byte patterns cover every form seen so far. Run the diagnostic first and
-- only run the UPDATEs whose SELECT actually returns rows.

-- ── 1. Diagnostic — run this on its own and read the HEX output ──────────────
SELECT id, assigned_to, task, HEX(task) AS task_hex
FROM masters
WHERE CONVERT(task USING binary) LIKE CONCAT('%', 0x92, '%')             -- raw CP1252 '
   OR CONVERT(task USING binary) LIKE CONCAT('%', 0xC3A2E282ACE284A2, '%')  -- double-encoded '
   OR CONVERT(task USING binary) LIKE CONCAT('%', 0xE28099, '%');           -- valid UTF-8 '

-- ── 2. Raw CP1252 byte 0x92 → ASCII apostrophe ──────────────────────────────
UPDATE masters
SET task = CONVERT(REPLACE(CONVERT(task USING binary), 0x92, 0x27) USING utf8mb4)
WHERE CONVERT(task USING binary) LIKE CONCAT('%', 0x92, '%');

-- ── 3. Double-encoded 'â€™' → ASCII apostrophe ──────────────────────────────
UPDATE masters
SET task = CONVERT(REPLACE(CONVERT(task USING binary), 0xC3A2E282ACE284A2, 0x27) USING utf8mb4)
WHERE CONVERT(task USING binary) LIKE CONCAT('%', 0xC3A2E282ACE284A2, '%');

-- ── 4. Valid but curly UTF-8 ' → ASCII apostrophe ───────────────────────────
-- Cosmetic only; these already render correctly. Skip it if you would rather
-- keep the typographic apostrophe.
UPDATE masters
SET task = REPLACE(task, CONVERT(0xE28099 USING utf8mb4), '''')
WHERE CONVERT(task USING binary) LIKE CONCAT('%', 0xE28099, '%');

-- ── 5. Verify — this should come back empty for patterns 2 and 3 ────────────
SELECT id, assigned_to, task
FROM masters
WHERE CONVERT(task USING binary) LIKE CONCAT('%', 0x92, '%')
   OR CONVERT(task USING binary) LIKE CONCAT('%', 0xC3A2E282ACE284A2, '%');
