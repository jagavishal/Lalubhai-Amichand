Self-hosted third-party scripts for Export Documentation's "All Documents" /
Excel downloads (public/js/pages/export-docs.js).

These used to load from cdnjs.cloudflare.com at runtime. That is what made
"download not working" — any firewall, proxy, or CDN hiccup on the office
network left the download stuck with nothing produced. Same-origin removes
that failure mode entirely: if these can't load, the app itself isn't
loading either.

  html2pdf.bundle.min.js  html2pdf.js 0.10.1 (bundles html2canvas + jsPDF)
                          https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js
  jszip.min.js            JSZip 3.10.1
                          https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
  xlsx.full.min.js        SheetJS 0.20.3, straight from node_modules/xlsx/dist/
                          — kept in sync with server-side (backend/bulk-mail.js).
                          package.json points "xlsx" at SheetJS's own CDN
                          tarball (cdn.sheetjs.com), not the npm registry:
                          the registry's last publish, 0.18.5, has two open
                          high-severity CVEs (prototype pollution, ReDoS —
                          GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) that were
                          never patched there; 0.20.3 fixes both. Re-copy this
                          file whenever the xlsx version in package.json changes.

All MIT-licensed. To update: re-download the cdnjs files at a newer pinned
version, or re-copy node_modules/xlsx/dist/xlsx.full.min.js after bumping
the `xlsx` dependency in package.json.
