-- One-time update: real Max Level values for the 86 already-imported Stores items,
-- sourced from the "Item List" tab of the Stores Google Sheet
-- (https://docs.google.com/spreadsheets/d/19wbm97_bYYsVDCpgOzGHZlriYc81McuPSKpqumf96MI).
-- Max Level there is a live array formula: Avg Daily Consumption * Lead Time + Safety Factor
-- (columns J*K+L) -- the sheet's own reorder-point calculation, not a fixed manual number.
-- MOQ ("MOQ (KG)" column) is 0 for every single item in that sheet too, so it is left
-- untouched here -- nothing to import for it.
--
-- 48 of 87 items get a real Max Level below; the remaining 39 compute
-- to blank in the sheet itself (IF(AvgDailyConsumption, ..., "") -- the formula only
-- produces a value once an item has *any* recorded consumption). Those items will
-- keep showing no color-coding in the IMS app until they have consumption history --
-- this matches the reference sheet's own behavior, not a gap in the import.

UPDATE ims_items SET max_level = 50.12903225806452 WHERE item_code = 'SKU 1';
UPDATE ims_items SET max_level = 31.806451612903224 WHERE item_code = 'SKU 2';
UPDATE ims_items SET max_level = 100.52258064516128 WHERE item_code = 'SKU 3';
UPDATE ims_items SET max_level = 104.25806451612902 WHERE item_code = 'SKU 4';
UPDATE ims_items SET max_level = 118.41612903225806 WHERE item_code = 'SKU 5';
UPDATE ims_items SET max_level = 100.70967741935483 WHERE item_code = 'SKU 6';
UPDATE ims_items SET max_level = 1000.9032258064516 WHERE item_code = 'SKU 7';
UPDATE ims_items SET max_level = 1001.6129032258065 WHERE item_code = 'SKU 8';
UPDATE ims_items SET max_level = 300.9032258064516 WHERE item_code = 'SKU 9';
UPDATE ims_items SET max_level = 100.19354838709677 WHERE item_code = 'SKU 10';
UPDATE ims_items SET max_level = 101.06451612903226 WHERE item_code = 'SKU 11';
UPDATE ims_items SET max_level = 1041.9354838709678 WHERE item_code = 'SKU 12';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 13';
UPDATE ims_items SET max_level = 20.383870967741935 WHERE item_code = 'SKU 14';
UPDATE ims_items SET max_level = 21.316129032258065 WHERE item_code = 'SKU 15';
UPDATE ims_items SET max_level = 111.21290322580646 WHERE item_code = 'SKU 16';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 17';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 18';
UPDATE ims_items SET max_level = 51.32967741935484 WHERE item_code = 'SKU 19';
UPDATE ims_items SET max_level = 5.516129032258064 WHERE item_code = 'SKU 20';
UPDATE ims_items SET max_level = 4.129032258064516 WHERE item_code = 'SKU 21';
UPDATE ims_items SET max_level = 108.91935483870968 WHERE item_code = 'SKU 22';
UPDATE ims_items SET max_level = 107.73612903225806 WHERE item_code = 'SKU 23';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 24';
UPDATE ims_items SET max_level = 208.19677419354838 WHERE item_code = 'SKU 25';
UPDATE ims_items SET max_level = 210.92903225806452 WHERE item_code = 'SKU 26';
UPDATE ims_items SET max_level = 320.20516129032256 WHERE item_code = 'SKU 27';
UPDATE ims_items SET max_level = 209.41612903225806 WHERE item_code = 'SKU 28';
UPDATE ims_items SET max_level = 252.43870967741935 WHERE item_code = 'SKU 29';
UPDATE ims_items SET max_level = 301.1290322580645 WHERE item_code = 'SKU 30';
UPDATE ims_items SET max_level = 212.8709677419355 WHERE item_code = 'SKU 31';
UPDATE ims_items SET max_level = 256.2774193548387 WHERE item_code = 'SKU 32';
UPDATE ims_items SET max_level = 253.5 WHERE item_code = 'SKU 33';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 34';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 35';
UPDATE ims_items SET max_level = 300.19354838709677 WHERE item_code = 'SKU 36';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 37';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 38';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 39';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 40';
UPDATE ims_items SET max_level = 6.774193548387097 WHERE item_code = 'SKU 41';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 42';
UPDATE ims_items SET max_level = 253.38709677419354 WHERE item_code = 'SKU 43';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 44';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 45';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 46';
UPDATE ims_items SET max_level = 3.806451612903226 WHERE item_code = 'SKU 47';
UPDATE ims_items SET max_level = 100.58064516129032 WHERE item_code = 'SKU 48';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 49';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 50';
UPDATE ims_items SET max_level = 26.032258064516128 WHERE item_code = 'SKU 51';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 52';
UPDATE ims_items SET max_level = 11.032258064516128 WHERE item_code = 'SKU 53';
UPDATE ims_items SET max_level = 36.45161290322581 WHERE item_code = 'SKU 54';
UPDATE ims_items SET max_level = 1.1935483870967742 WHERE item_code = 'SKU 55';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 56';
UPDATE ims_items SET max_level = 21032.25806451613 WHERE item_code = 'SKU 57';
UPDATE ims_items SET max_level = 20096.774193548386 WHERE item_code = 'SKU 58';
UPDATE ims_items SET max_level = 16.032258064516128 WHERE item_code = 'SKU 59';
UPDATE ims_items SET max_level = 13.096774193548388 WHERE item_code = 'SKU 60';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 61';
UPDATE ims_items SET max_level = 15.67741935483871 WHERE item_code = 'SKU 62';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 63';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 64';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 65';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 66';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 67';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 68';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 69';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 70';
UPDATE ims_items SET max_level = 12.096774193548388 WHERE item_code = 'SKU 71';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 72';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 73';
UPDATE ims_items SET max_level = 6.129032258064516 WHERE item_code = 'SKU 74';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 75';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 76';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 77';
UPDATE ims_items SET max_level = 3.225806451612903 WHERE item_code = 'SKU 78';
UPDATE ims_items SET max_level = 43.354838709677416 WHERE item_code = 'SKU 79';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 80';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 81';
UPDATE ims_items SET max_level = 3.5 WHERE item_code = 'SKU 82';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 83';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 84';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 85';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 86';
UPDATE ims_items SET max_level = 0 WHERE item_code = 'SKU 87';
